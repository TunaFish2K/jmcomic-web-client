import md5 from "crypto-js/md5";
import encodingHex from "crypto-js/enc-hex";

export const client = new (class Client {
    getToken(timestampSeconds: number, secret: string) {
        return md5(`${timestampSeconds}${secret}`).toString(encodingHex);
    }
    getTokenParam(timestampSeconds: number, version: string) {
        return `${timestampSeconds},${version}`;
    }
})();
