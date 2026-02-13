import md5 from "crypto-js/md5";
import encodingHex from "crypto-js/enc-hex";
import aes from "crypto-js/aes";
import modeECB from "crypto-js/mode-ecb";
import noPadding from "crypto-js/pad-nopadding";
import encodingUTF8 from "crypto-js/enc-utf8";
import {
    DOMAIN_SERVER_URL,
    INITIAL_VERSION,
    SECRET,
    SECRET_APP_DATA,
    SECRET_DOMAIN_SERVER,
} from "./constants";
import pLimit from "p-limit";
import parse, { parse as parseSetCookie } from "set-cookie-parser";

function getToken(timestampSeconds: number, secret: string) {
    return md5(`${timestampSeconds}${secret}`).toString(encodingHex);
}
function getTokenParam(timestampSeconds: number, version: string) {
    return `${timestampSeconds},${version}`;
}
function decryptResponseData(encryptedData: string, secret: string) {
    const decrypted = aes.decrypt(
        encryptedData,
        CryptoJS.enc.Utf8.parse(secret),
        {
            mode: modeECB,
            padding: noPadding,
        },
    );

    let decryptedString = decrypted.toString(encodingUTF8);

    const padLength = decryptedString.charCodeAt(decryptedString.length - 1);
    if (padLength && padLength <= 16) {
        decryptedString = decryptedString.slice(0, -padLength);
    }

    return decryptedString;
}
async function getDomainsFromDomainServer(domainServerURL: string) {
    const res = await fetch(domainServerURL);
    const encryptedData = await res.text();
    const secret = md5(SECRET_DOMAIN_SERVER).toString(encodingHex);
    const decryptedData = decryptResponseData(encryptedData, secret);
    const obj = JSON.parse(decryptedData);
    return obj.Server as string[];
}
async function checkDomainStatus(domain: string, timeoutMs: number = 5000) {
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
async function pickFastestAvailableDomainToBaseURL(
    domains: string[],
    checkConcurrency: number = 20,
) {
    const limit = pLimit(checkConcurrency);
    const tasks = domains.map((v) => limit(() => checkDomainStatus(v)));
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
function getCurrentTimestampSeconds() {
    return Math.floor(Date.now() / 1000);
}
function getCookieHeader(setCookie: parse.CookieMap) {
    const result: string[] = [];

    for (const [name, { value }] of Object.entries(setCookie)) {
        result.push(`${name}=${value}`);
    }

    return result.join("; ");
}
export async function getFastestAvailableBaseURL(
    domainServerURL?: string,
    checkConcurrency?: number,
) {
    if (!domainServerURL) {
        domainServerURL =
            DOMAIN_SERVER_URL[
                Math.floor(Math.random() * DOMAIN_SERVER_URL.length)
            ];
    }
    const domains = await getDomainsFromDomainServer(domainServerURL);
    return await pickFastestAvailableDomainToBaseURL(domains, checkConcurrency);
}
export class Client {
    baseURL: string;
    constructor(baseURL: string) {
        this.baseURL = baseURL;
    }
    async getClientData() {
        const url = new URL("/setting", this.baseURL);
        const timestampSeconds = getCurrentTimestampSeconds();
        const res = await fetch(url, {
            headers: {
                token: getToken(timestampSeconds, SECRET),
                tokenparam: getTokenParam(timestampSeconds, INITIAL_VERSION),
            },
        });
        const setCookie = res.headers.getSetCookie();
        const setCookieData = parseSetCookie(setCookie, { map: true });
        const cookie = getCookieHeader(setCookieData);

        const encryptedData = (await res.json()).data as string;
        const decryptedData = decryptResponseData(
            encryptedData,
            getToken(timestampSeconds, SECRET_APP_DATA),
        );
        const { version, img_host: imageBaseURL } = JSON.parse(
            decryptedData,
        ) as { version: string; img_host: string };
        return {
            version,
            imageBaseURL,
            cookie,
        };
    }
}
