import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageWorkerClient } from '../src/image-bridge';

class Transport {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    sent: { id: number }[] = [];
    terminated = false;
    postMessage(message: { id: number }) { this.sent.push(message); }
    terminate() { this.terminated = true; }
    finish(index: number) {
        this.onmessage?.({ data: { id: this.sent[index].id, result: { data: new Uint8Array([1]), width: 1, height: 1, mime: 'image/png' } } });
    }
}

test('image bridge cancels queued and active consumers without misrouting the next result', async () => {
    const transport = new Transport();
    const client = new ImageWorkerClient(() => transport as unknown as Worker);
    const active = new AbortController(), queued = new AbortController();
    const first = client.process(new ArrayBuffer(1), 0, { signal: active.signal });
    const second = client.process(new ArrayBuffer(1), 0, { signal: queued.signal });
    const third = client.process(new ArrayBuffer(1), 0);
    const rejected = Promise.all([assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })]);
    queued.abort(); active.abort(); await rejected;
    assert.equal(transport.sent.length, 1);
    transport.finish(0);
    assert.equal(transport.sent.length, 2);
    transport.finish(1);
    assert.equal((await third).width, 1);
    client.dispose(); assert.equal(transport.terminated, true);
});

test('image bridge bounds its queue and recovers after worker startup failure', async () => {
    const transports: Transport[] = [];
    const client = new ImageWorkerClient(() => {
        const transport = new Transport(); transports.push(transport); return transport as unknown as Worker;
    });
    const jobs = Array.from({ length: 17 }, () => client.process(new ArrayBuffer(1), 0));
    await assert.rejects(client.process(new ArrayBuffer(1), 0), { code: 'BUSY' });
    const rejected = Promise.all(jobs.map(job => assert.rejects(job, /failed to start/)));
    transports[0].onerror?.(); await rejected;
    const next = client.process(new ArrayBuffer(1), 0);
    transports[1].finish(0); assert.equal((await next).height, 1);
    client.dispose();
});
