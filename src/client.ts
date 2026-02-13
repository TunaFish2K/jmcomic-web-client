import md5 from "crypto-js/md5";
import encodingHex from "crypto-js/enc-hex";
import aes from "crypto-js/aes";
import modeECB from "crypto-js/mode-ecb";
import noPadding from "crypto-js/pad-nopadding";
import encodingUTF8 from "crypto-js/enc-utf8";
import { SECRET_DOMAIN_SERVER } from "./constants";
import pLimit from "p-limit";

export const client = new (class Client {
    getToken(timestampSeconds: number, secret: string) {
        return md5(`${timestampSeconds}${secret}`).toString(encodingHex);
    }
    getTokenParam(timestampSeconds: number, version: string) {
        return `${timestampSeconds},${version}`;
    }
    decryptResponseData(encryptedData: string, secret: string) {
        const decrypted = aes.decrypt(
            encryptedData,
            CryptoJS.enc.Utf8.parse(secret),
            {
                mode: modeECB,
                padding: noPadding,
            },
        );

        let decryptedString = decrypted.toString(encodingUTF8);

        const padLength = decryptedString.charCodeAt(
            decryptedString.length - 1,
        );
        if (padLength && padLength <= 16) {
            decryptedString = decryptedString.slice(0, -padLength);
        }

        return decryptedString;
    }
    async getDomainsFromDomainServer(domainServerURL: string) {
        const res = await fetch(domainServerURL);
        const encryptedData = await res.text();
        const secret = md5(SECRET_DOMAIN_SERVER).toString(encodingHex);
        const decryptedData = this.decryptResponseData(encryptedData, secret);
        const obj = JSON.parse(decryptedData);
        return obj.Server as string[];
    }
    async checkDomainStatus(domain: string, timeoutMs: number = 5000) {
        try {
            const url = `https://${domain}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => {
                controller.abort();
            }, timeoutMs);
            const startMs = performance.now();
            await fetch(url, {
                mode: "no-cors",
                signal: controller.signal,
            });
            const endMs = performance.now();
            clearTimeout(timeout);
            return {
                domain,
                available: true as const,
                timeMs: endMs - startMs,
            };
        } catch {
            return {
                domain,
                available: false as const,
                timeMs: null,
            };
        }
    }
    async pickFastestAvailableDomainToBaseURL(
        domains: string[],
        checkConcurrency: number = 20,
    ) {
        const limit = pLimit(checkConcurrency);
        const tasks = domains.map((v) =>
            limit(() => this.checkDomainStatus(v)),
        );
        const checkResult = await Promise.all(tasks);
        const unavailableFiltered = checkResult.filter((v) => v.available);
        const fastestSorted = unavailableFiltered.sort(
            (a, b) => a.timeMs - b.timeMs,
        );
        const theFastestAvailable = fastestSorted[0] ?? null;
        return theFastestAvailable !== null
            ? `https://${theFastestAvailable}`
            : null;
    }
    }
})();
