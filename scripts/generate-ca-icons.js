#!/usr/bin/env node
/* eslint-disable no-console */

// Scans every subfolder under src/assets/fonts/ca/, reads the prefix map
// declared in moodle.config.json (iconsPrefixes.ca) and merges the resulting
// entries into src/assets/fonts/icons.json. Safe to run repeatedly: existing
// CA entries are replaced with the scan result; non-CA entries are kept in
// their original order.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CA_DIR = path.join(ROOT, 'src/assets/fonts/ca');
const ICONS_JSON = path.join(ROOT, 'src/assets/fonts/icons.json');
const MOODLE_CONFIG = path.join(ROOT, 'moodle.config.json');
const CONFIG_ROOT_KEY = 'ca';

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

    // Normalize: { solid: ["ca"] } → Map("solid" → ["ca"])
    const map = new Map();
    for (const [subfolder, prefixes] of Object.entries(group)) {
        const list = Array.isArray(prefixes) ? prefixes.filter(Boolean) : [];
        if (list.length) map.set(subfolder, list);
    }
    return map;
}

function collectCaEntries(prefixMap) {
    if (!fs.existsSync(CA_DIR)) {
        console.error(`[error] CA icons directory not found: ${CA_DIR}`);
        process.exit(1);
    }

    const entries = {};
    const subdirs = fs.readdirSync(CA_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

    for (const sub of subdirs) {
        const prefixes = prefixMap.get(sub);
        if (!prefixes) {
            console.warn(`[warn] ca/${sub}/ has no prefix declared in moodle.config.json → iconsPrefixes.${CONFIG_ROOT_KEY}.${sub}. Skipping.`);
            continue;
        }

        const subPath = path.join(CA_DIR, sub);
        const svgFiles = fs.readdirSync(subPath)
            .filter((f) => f.toLowerCase().endsWith('.svg'))
            .sort();

        for (const file of svgFiles) {
            const nameNoExt = file.replace(/\.svg$/i, '');
            const value = `assets/fonts/ca/${sub}/${file}`;
            for (const prefix of prefixes) {
                entries[`${prefix}-${nameNoExt}`] = value;
            }
        }
    }

    return entries;
}

function buildIsCaKey(prefixMap) {
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
    const caEntries = collectCaEntries(prefixMap);
    const isCaKey = buildIsCaKey(prefixMap);

    const raw = fs.readFileSync(ICONS_JSON, 'utf8');
    let current;
    try {
        current = JSON.parse(raw);
    } catch (err) {
        console.error(`[error] Could not parse icons.json: ${err.message}`);
        process.exit(1);
    }

    // Preserve non-CA entries in current order, drop every previous CA entry.
    const merged = {};
    for (const [key, value] of Object.entries(current)) {
        if (!isCaKey(key)) merged[key] = value;
    }

    // Append refreshed CA entries sorted alphabetically.
    const sortedCaKeys = Object.keys(caEntries).sort();
    for (const key of sortedCaKeys) {
        merged[key] = caEntries[key];
    }

    const nextRaw = JSON.stringify(merged);
    const previousCaKeys = Object.keys(current).filter(isCaKey);
    const added = sortedCaKeys.filter((k) => !(k in current));
    const removed = previousCaKeys.filter((k) => !(k in caEntries));
    const changed = sortedCaKeys.filter((k) => k in current && current[k] !== caEntries[k]);

    console.log(`Prefix map (from moodle.config.json → iconsPrefixes.${CONFIG_ROOT_KEY}):`);
    for (const [sub, prefixes] of prefixMap.entries()) {
        console.log(`  ca/${sub}/  →  ${prefixes.map((p) => `${p}-*`).join(', ')}`);
    }
    console.log(`CA entries found: ${sortedCaKeys.length}`);
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
