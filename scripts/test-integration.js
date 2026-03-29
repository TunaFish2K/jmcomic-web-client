// This script runs simple integration tests against the Worker
const BASE_URL = "http://localhost:8787";

async function runTests() {
  console.log("Starting integration tests against", BASE_URL);

  try {
    // 1. Test Search
    console.log("👉 Testing /search...");
    const searchRes = await fetch(`${BASE_URL}/search?query=blue`);
    if (!searchRes.ok)
      throw new Error(
        `Search request failed: ${searchRes.status} ${searchRes.statusText}`,
      );

    const searchData = await searchRes.json();
    console.log("✅ Search OK. Found:", searchData.total, "results.");

    // 1.5 Test batch-album parameter validation
    console.log("👉 Testing /batch-album validation...");
    const batchBadRes = await fetch(`${BASE_URL}/batch-album`);
    if (batchBadRes.status !== 400)
      throw new Error(
        `Batch validation failed: expected 400, got ${batchBadRes.status}`,
      );
    console.log("✅ Batch validation OK.");

    let albumId = "555555"; // Default ID if search fails to return content
    if (searchData.content && searchData.content.length > 0) {
      albumId = searchData.content[0].id;
      console.log(`   Using first result album ID: ${albumId}`);
    }

    // 2. Test Album
    console.log(`👉 Testing /album/${albumId}...`);
    const albumRes = await fetch(`${BASE_URL}/album/${albumId}`);
    if (!albumRes.ok)
      throw new Error(
        `Album request failed: ${albumRes.status} ${albumRes.statusText}`,
      );

    const albumData = await albumRes.json();
    console.log("✅ Album OK. Title:", albumData.name);

    // 3. Test Photo (Chapter)
    // We need a valid photo ID from the album
    let photoId = "0";
    if (albumData.series && albumData.series.length > 0) {
      // It seems 'series' might contain chapters or related works.
      // Based on client.ts, series has { id, name, sort }
      photoId = albumData.series[0].id;
    } else if (albumData.images && albumData.images.length > 0) {
      // If album structure is different, we might need another way.
      // For now, let's skip if we can't find a chapter ID easily without more logic
      console.log(
        "⚠️  Skipping photo test: Could not determine chapter ID from album data.",
      );
    }

    if (photoId !== "0") {
      console.log(`👉 Testing /photo/${photoId}...`);
      const photoRes = await fetch(`${BASE_URL}/photo/${photoId}`);
      if (!photoRes.ok)
        throw new Error(
          `Photo request failed: ${photoRes.status} ${photoRes.statusText}`,
        );
      const photoData = await photoRes.json();
      console.log("✅ Photo OK. Images count:", photoData.images?.length);
    }

    console.log("\n🎉 All integration tests passed!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Wait for a few seconds to ensure worker is up, then run
setTimeout(runTests, 2000);
