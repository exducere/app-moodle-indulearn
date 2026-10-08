#!/usr/bin/env node
/* eslint-disable no-console */

// Scans every subfolder under src/assets/fonts/moot/, reads the prefix map
// declared in moodle.config.json (iconsPrefixes.moot) and merges the resulting
// entries into src/assets/fonts/icons.json. Safe to run repeatedly: existing
// MOOT entries are replaced with the scan result; non-MOOT entries are kept in
// their original order.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOOT_DIR = path.join(ROOT, 'src/assets/fonts/moot');
const ICONS_JSON = path.join(ROOT, 'src/assets/fonts/icons.json');
const MOODLE_CONFIG = path.join(ROOT, 'moodle.config.json');
const CONFIG_ROOT_KEY = 'moot';

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadPrefixMap() {
    if (!fs.existsSync(MOODLE_CONFIG)) {
        console.error(`[error] moodle.config.json not found: ${MOODLE_CONFIG}`);
        process.exit(1);
    }

    const config = readJson(MOODLE_CONFIG);
    const group = config?.iconsPrefixes?.[CONFIG_ROOT_KEY];

    if (!group || typeof group !== 'object') {
        console.error(`[error] iconsPrefixes.${CONFIG_ROOT_KEY} is missing in moodle.config.json`);
        process.exit(1);
    }

    // Normalize: { light: ["puce"] } → Map("light" → ["puce"])
    const map = new Map();
    for (const [subfolder, prefixes] of Object.entries(group)) {
        const list = Array.isArray(prefixes) ? prefixes.filter(Boolean) : [];
        if (list.length) map.set(subfolder, list);
    }
    return map;
}

function collectMootEntries(prefixMap) {
    if (!fs.existsSync(MOOT_DIR)) {
        console.error(`[error] Moot icons directory not found: ${MOOT_DIR}`);
        process.exit(1);
    }

    const entries = {};
    const subdirs = fs.readdirSync(MOOT_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

    for (const sub of subdirs) {
        const prefixes = prefixMap.get(sub);
        if (!prefixes) {
            console.warn(`[warn] moot/${sub}/ has no prefix declared in moodle.config.json → iconsPrefixes.${CONFIG_ROOT_KEY}.${sub}. Skipping.`);
            continue;
        }

        const subPath = path.join(MOOT_DIR, sub);
        const svgFiles = fs.readdirSync(subPath)
            .filter((f) => f.toLowerCase().endsWith('.svg'))
            .sort();

        for (const file of svgFiles) {
            const nameNoExt = file.replace(/\.svg$/i, '');
            const value = `assets/fonts/moot/${sub}/${file}`;
            for (const prefix of prefixes) {
                entries[`${prefix}-${nameNoExt}`] = value;
            }
        }
    }

    return entries;
}

function buildIsMootKey(prefixMap) {
    const allPrefixes = [...new Set([].concat(...prefixMap.values()))];
    return (key) => allPrefixes.some((p) => key === p || key.startsWith(`${p}-`));
}

function main() {
    const dryRun = process.argv.includes('--check') || process.argv.includes('--dry-run');

    if (!fs.existsSync(ICONS_JSON)) {
        console.error(`[error] icons.json not found: ${ICONS_JSON}`);
        process.exit(1);
    }

    const prefixMap = loadPrefixMap();
    const mootEntries = collectMootEntries(prefixMap);
    const isMootKey = buildIsMootKey(prefixMap);

    const raw = fs.readFileSync(ICONS_JSON, 'utf8');
    let current;
    try {
        current = JSON.parse(raw);
    } catch (err) {
        console.error(`[error] Could not parse icons.json: ${err.message}`);
        process.exit(1);
    }

    // Preserve non-MOOT entries in current order, drop every previous MOOT entry.
    const merged = {};
    for (const [key, value] of Object.entries(current)) {
        if (!isMootKey(key)) merged[key] = value;
    }

    // Append refreshed MOOT entries sorted alphabetically.
    const sortedMootKeys = Object.keys(mootEntries).sort();
    for (const key of sortedMootKeys) {
        merged[key] = mootEntries[key];
    }

    const nextRaw = JSON.stringify(merged);
    const previousMootKeys = Object.keys(current).filter(isMootKey);
    const added = sortedMootKeys.filter((k) => !(k in current));
    const removed = previousMootKeys.filter((k) => !(k in mootEntries));
    const changed = sortedMootKeys.filter((k) => k in current && current[k] !== mootEntries[k]);

    console.log(`Prefix map (from moodle.config.json → iconsPrefixes.${CONFIG_ROOT_KEY}):`);
    for (const [sub, prefixes] of prefixMap.entries()) {
        console.log(`  moot/${sub}/  →  ${prefixes.map((p) => `${p}-*`).join(', ')}`);
    }
    console.log(`MOOT entries found: ${sortedMootKeys.length}`);
    if (added.length) console.log(`  + added:   ${added.length}  (${added.slice(0, 5).join(', ')}${added.length > 5 ? ', …' : ''})`);
    if (removed.length) console.log(`  - removed: ${removed.length}  (${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ', …' : ''})`);
    if (changed.length) console.log(`  ~ changed: ${changed.length}`);

    if (nextRaw === raw) {
        console.log('icons.json already up to date.');
        return;
    }

    if (dryRun) {
        console.log('[dry-run] icons.json would change. Run without --check to apply.');
        process.exit(1);
    }

    fs.writeFileSync(ICONS_JSON, nextRaw);
    console.log(`Updated ${path.relative(ROOT, ICONS_JSON)}.`);
}

main();
