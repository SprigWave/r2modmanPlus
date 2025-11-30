const fs = require('fs');
const path = require('path');

// Preserving the original relative path logic
const ecosystemPath = path.join(__dirname, '../src/assets/data/ecosystem.json');

function ensureOther(distArray) {
    if (!Array.isArray(distArray)) return false;
    const exists = distArray.some(d => d && d.platform === 'other');
    if (!exists) {
        distArray.push({ platform: 'other', identifier: null });
        return true;
    }
    return false;
}

function main() {
    const raw = fs.readFileSync(ecosystemPath, 'utf8');
    const data = JSON.parse(raw);

    let changed = 0;

    if (!data.games || typeof data.games !== 'object') {
        console.error('No games object found in ecosystem.json');
        process.exit(1);
    }

    for (const key of Object.keys(data.games)) {
        const game = data.games[key];
        // Top-level distributions
        if (ensureOther(game.distributions)) changed++;

        // r2modman entries (if present)
        if (Array.isArray(game.r2modman)) {
            for (const r2 of game.r2modman) {
                if (r2 && ensureOther(r2.distributions)) changed++;
            }
        }
    }

    // UPDATED: Now writes back to the original source path instead of /tmp
    fs.writeFileSync(ecosystemPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Overwrote original file at ${ecosystemPath}. Total insertions: ${changed}`);
}

main();
