// Fetch http://localhost:3000/api?lat=-33.4489&lon=-70.6693

async function main() {
  let response = await fetch(
    "http://localhost:3000/api?lat=-33.4489&lon=-70.6693",
  );
  let data = await response.json();
  console.log(data);

  document.getElementById("output").textContent = JSON.stringify(data, null, 2);
}

main();
