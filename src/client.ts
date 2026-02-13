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
    SECRET_CONTENT,
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
    const decrypted = aes.decrypt(encryptedData, encodingUTF8.parse(secret), {
        mode: modeECB,
        padding: noPadding,
    });

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

export async function getClientData(baseURL: string) {
    const url = new URL("/setting", baseURL);
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
    const { version, img_host: imageBaseURL } = JSON.parse(decryptedData) as {
        version: string;
        img_host: string;
    };
    return {
        version,
        imageBaseURL,
        cookie,
    };
}

export async function getClientDataAndCreateClient(baseURL: string) {
    const { version, imageBaseURL, cookie } = await getClientData(baseURL);
    return new Client(baseURL, version, imageBaseURL, cookie);
}

export class Client {
    baseURL: string;
    version: string;
    imageBaseURL: string;
    cookie: string;
    constructor(
        baseURL: string,
        version: string,
        imageBaseURL: string,
        cookie: string,
    ) {
        this.baseURL = baseURL;
        this.version = version;
        this.imageBaseURL = imageBaseURL;
        this.cookie = cookie;
    }

    async search(
        query: string,
        options?: {
            mainTag?: 0 | 1 | 2 | 3 | 4;
            orderBy?: "mr" | "mv" | "mp" | "tf";
            time?: "a" | "t" | "w" | "m";
            page?: number;
        },
    ) {
        if (!options) options = {};
        if (!options.mainTag) options.mainTag = 0;
        if (!options.orderBy) options.orderBy = "mr";
        if (!options.time) options.time = "a";
        if (!options.page) options.page = 1;

        const url = new URL("/search", this.baseURL);
        url.searchParams.set("search_query", query);
        url.searchParams.set("main_tag", options.mainTag.toString());
        url.searchParams.set("o", options.orderBy);
        url.searchParams.set("t", options.time);
        url.searchParams.set("page", options.page.toString());

        const timestampSeconds = getCurrentTimestampSeconds();
        const res = await fetch(url, {
            headers: {
                token: getToken(timestampSeconds, SECRET),
                tokenparam: getTokenParam(timestampSeconds, this.version),
                Cookie: this.cookie,
            },
        });
        const encryptedData = (await res.json()).data as string;
        const decryptedData = decryptResponseData(
            encryptedData,
            getToken(timestampSeconds, SECRET_APP_DATA),
        );
        return JSON.parse(decryptedData) as {
            search_query: string;
            total: string;
        } & (
            | {
                  redirect_aid: string;
                  content: [];
              }
            | {
                  redirect_aid: never;
                  content: {
                      id: string;
                      author: string;
                      name: string;
                  }[];
              }
        );
    }
    async getAlbum(id: string) {
        const url = new URL("/album", this.baseURL);
        url.searchParams.set("id", id);
        const timestampSeconds = getCurrentTimestampSeconds();
        const res = await fetch(url, {
            headers: {
                token: getToken(timestampSeconds, SECRET),
                tokenparam: getTokenParam(timestampSeconds, this.version),
                Cookie: this.cookie,
            },
        });
        const encryptedData = (await res.json()).data as string;
        const decryptedData = decryptResponseData(
            encryptedData,
            getToken(timestampSeconds, SECRET_APP_DATA),
        );
        const {
            name,
            images,
            description,
            total_views: totalViews,
            likes,
            series,
            series_id: seriesID,
            author,
            tags,
            works,
            actors,
        } = JSON.parse(decryptedData) as {
            id: number;
            name: string;
            images: string[];
            description: string | null;

            total_views: string;
            likes: string;

            series: { id: string; name: string; sort: string }[];
            series_id: string;

            author: string[];
            tags: string[];
            works: string[];
            actors: string[];
        };
        if (name === null) return null;
        return {
            id,
            name,
            images,
            description,
            totalViews,
            likes,
            series,
            seriesID,
            author,
            tags,
            works,
            actors,
        };
    }
    async getPhoto(id: string) {
        const url = new URL("/chapter", this.baseURL);
        url.searchParams.set("id", id);
        const timestampSeconds = getCurrentTimestampSeconds();
        const res = await fetch(url, {
            headers: {
                Cookie: this.cookie,
                token: getToken(timestampSeconds, SECRET),
                tokenparam: getTokenParam(timestampSeconds, this.version),
            },
        });
        const encryptedData = ((await res.json()) as { data: string }).data;
        const decryptedData = decryptResponseData(
            encryptedData,
            getToken(timestampSeconds, SECRET_APP_DATA),
        );
        const { name, images } = JSON.parse(decryptedData) as {
            name: string;
            id: string;
            images: string[];
        };
        if (name === null) return null;
        return {
            name,
            id,
            images: images.map((name) => ({
                name,
                url: new URL(
                    `/media/photos/${id}/${name}`,
                    this.imageBaseURL,
                ).toString(),
            })),
        };
    }
    async getScrambleId(photoId: string) {
        const timestampSeconds = getCurrentTimestampSeconds();

        const url = new URL("/chapter_view_template", this.baseURL);
        url.searchParams.set("id", photoId);
        url.searchParams.set("mode", "vertical");
        url.searchParams.set("page", String(0));
        url.searchParams.set("app_img_shunt", String(1));
        url.searchParams.set("express", "off");
        url.searchParams.set("v", timestampSeconds.toString());
        const res = await fetch(url, {
            headers: {
                Cookie: this.cookie,
                token: getToken(timestampSeconds, SECRET_CONTENT),
                tokenparam: getTokenParam(timestampSeconds, this.version),
            },
        });
        const text = await res.text();
        const matchResult = text.match(/var scramble_id = (\d+);/);
        if (matchResult === null) throw new Error("scrambleId not found");
        return parseInt(matchResult[1]);
    }
    async getPhotoWithScrambleId(id: string) {
        const photo = await this.getPhoto(id);
        if (photo === null) return null;
        return {
            ...photo,
            scrambleId: await this.getScrambleId(id),
        };
    }
}
