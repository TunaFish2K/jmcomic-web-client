import {
    getClientDataAndCreateClient,
    getFastestAvailableBaseURL,
} from "../src/modules/client";

async function start() {
    const baseURL = await getFastestAvailableBaseURL();
    console.log("baseURL:", baseURL);
    const client = await getClientDataAndCreateClient(baseURL!);
    const searchResult = await client.search("蔚蓝档案");
    console.log("搜索结果：", searchResult);
    const album = await client.getAlbum("1235125");
    console.log("获取的本子：", album);
    const photo = await client.getPhoto("1235125");
    console.log("获取的章节：", photo);
}

start();
