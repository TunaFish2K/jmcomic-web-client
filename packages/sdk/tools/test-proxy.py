#!/usr/bin/env python3
"""Run only the child command through a private copy of v2rayN's active node."""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time


def configuration(source, port):
    original = json.loads(Path(source).read_text())
    node = next(x for x in original['outbounds'] if x.get('tag') == 'proxy')
    stream = node.get('streamSettings', {})
    if (node['protocol'], stream.get('network'), stream.get('security')) not in [
        ('vless', 'raw', 'reality'), ('vless', 'tcp', 'reality')
    ]:
        raise RuntimeError('Active node is not supported: expected VLESS TCP Reality')
    server = node['settings']['vnext'][0]
    user = server['users'][0]
    reality = stream['realitySettings']
    if stream.get('sockopt', {}).get('dialerProxy'):
        raise RuntimeError('Active node depends on a proxy chain; refusing to silently omit it')
    outbound = {
        'type': 'vless', 'tag': 'test-proxy',
        'server': server['address'], 'server_port': server['port'],
        'uuid': user['id'], 'flow': user.get('flow', ''),
        'tls': {
            'enabled': True, 'server_name': reality['serverName'],
            'utls': {'enabled': True, 'fingerprint': reality.get('fingerprint', 'chrome')},
            'reality': {'enabled': True, 'public_key': reality.get('publicKey') or reality.get('password'), 'short_id': reality.get('shortId', '')},
        },
    }
    routes = json.loads(subprocess.check_output(['ip', '-j', 'route', 'show', 'default']))
    physical = [r for r in routes if r.get('gateway') and r.get('dev')]
    if physical:
        outbound['bind_interface'] = min(physical, key=lambda r: r.get('metric', 0))['dev']
    return {'log': {'disabled': True},
            'inbounds': [{'type': 'mixed', 'tag': 'test-in', 'listen': '127.0.0.1', 'listen_port': port}],
            'outbounds': [outbound], 'route': {'final': 'test-proxy'}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path.home() / '.local/share/v2rayN'
    parser.add_argument('--config', default=str(root / 'binConfigs/config.json'))
    parser.add_argument('--binary', default=str(root / 'bin/sing_box/sing-box'))
    parser.add_argument('--android', help='adb device serial; maps test proxy into this device')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command and command[0] == '--': command = command[1:]
    if not command: parser.error('child command is required')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    adb = [os.environ.get('ADB', 'adb')]
    if args.android: adb += ['-s', args.android]
    with tempfile.TemporaryDirectory(prefix='jm-test-proxy-') as temp:
        path = Path(temp) / 'config.json'
        path.write_text(json.dumps(configuration(args.config, port)))
        path.chmod(0o600)
        # Never print core output: it can contain node addresses or credentials.
        checked = subprocess.run([args.binary, 'check', '-c', str(path)], capture_output=True)
        if checked.returncode: raise RuntimeError('sing-box rejected the temporary configuration')
        core = subprocess.Popen([args.binary, 'run', '-c', str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        child = None
        reversed_port = False
        def stop(signum, frame):
            raise KeyboardInterrupt
        old = signal.signal(signal.SIGTERM, stop)
        try:
            for _ in range(100):
                if core.poll() is not None: raise RuntimeError('test proxy exited during startup')
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1): break
                except OSError: time.sleep(.05)
            else: raise RuntimeError('test proxy startup timed out')
            if args.android:
                subprocess.run(adb + ['reverse', f'tcp:{port}', f'tcp:{port}'], check=True, stdout=subprocess.DEVNULL)
                reversed_port = True
            env = dict(os.environ)
            for name in ('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY'):
                env[name] = f'http://127.0.0.1:{port}'
            env['ALL_PROXY'] = env['all_proxy'] = f'socks5h://127.0.0.1:{port}'
            env['NO_PROXY'] = env['no_proxy'] = 'localhost,127.0.0.1,::1'
            env['JM_TEST_PROXY'] = f'127.0.0.1:{port}'
            command = [x.replace('{proxy}', env['JM_TEST_PROXY']) for x in command]
            print(f'Isolated test proxy ready on loopback:{port}', flush=True)
            child = subprocess.Popen(command, env=env, start_new_session=True)
            raise SystemExit(child.wait())
        finally:
            if child and child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            if reversed_port:
                subprocess.run(adb + ['reverse', '--remove', f'tcp:{port}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            core.terminate()
            try: core.wait(timeout=5)
            except subprocess.TimeoutExpired:
                core.kill()
                core.wait()
            signal.signal(signal.SIGTERM, old)


if __name__ == '__main__': main()
