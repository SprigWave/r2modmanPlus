import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "src", "model", "game", "GameManager.ts");
let code = fs.readFileSync(filePath, "utf-8");

// Regex to find the store platforms array (e.g. [...])
// and then check if StorePlatform.OTHER is missing.
const newCode = code.replace(
  /(\[)(\s*new StorePlatformMetadata\(.*?\))+(\])?/gs,
  (match: string) => {
    if (!match.includes("StorePlatform.OTHER")) {
      // Insert a comma + new StorePlatformMetadata(StorePlatform.OTHER)
      return match.replace(/\]$/, `, new StorePlatformMetadata(StorePlatform.OTHER)]`);
    }
    return match;
  }
);

if (newCode !== code) {
  fs.writeFileSync(filePath, newCode, "utf-8");
  console.log("Appended StorePlatform.OTHER where missing.");
} else {
  console.log("No changes needed.");
}