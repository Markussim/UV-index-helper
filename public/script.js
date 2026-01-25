// Fetch http://localhost:3000/api?lat=-33.4489&lon=-70.6693

let responseCache = null;

async function main() {
  const response = await fetch(
    "http://localhost:3000/api?lat=-33.4489&lon=-70.6693",
  );
  const data = await response.json();

  const serialized = JSON.stringify(data);

  if (serialized !== responseCache) {
    document.getElementById("output").textContent = JSON.stringify(
      data,
      null,
      2,
    );
    responseCache = serialized;
  } else {
    console.log("Same");
  }

  setTimeout(main, 100);
}

main();
