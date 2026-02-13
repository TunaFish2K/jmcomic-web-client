import md5 from "crypto-js/md5";
import encodingHex from "crypto-js/enc-hex";
import aes from "crypto-js/aes";
import modeECB from "crypto-js/mode-ecb";
import noPadding from "crypto-js/pad-nopadding";
import encodingUTF8 from "crypto-js/enc-utf8";

export const client = new (class Client {
    getToken(timestampSeconds: number, secret: string) {
        return md5(`${timestampSeconds}${secret}`).toString(encodingHex);
    }
    getTokenParam(timestampSeconds: number, version: string) {
        return `${timestampSeconds},${version}`;
    }
    decryptResponseData(data: string, secret: string) {
        const decrypted = aes.decrypt(data, CryptoJS.enc.Utf8.parse(secret), {
            mode: modeECB,
            padding: noPadding,
        });

        let decryptedString = decrypted.toString(encodingUTF8);

        const padLength = decryptedString.charCodeAt(
            decryptedString.length - 1,
        );
        if (padLength && padLength <= 16) {
            decryptedString = decryptedString.slice(0, -padLength);
        }

        return decryptedString;
    }
})();
