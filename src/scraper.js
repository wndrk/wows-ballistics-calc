import puppeteer from 'puppeteer';
import { URLS, SKIP_CLASSES } from './config.js';

// Timing configuration (from working scraper)
const TIMING = {
  pageLoadTimeout: 60000,
  sleepAfterPageLoad: 2000,
  sleepAfterClickAll: 500,
  sleepAfterExpand: 1500,
  sleepAfterCheckbox: 200,
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Click all "all" links to expand ship groups
 * @param {Page} page - Puppeteer page
 */
async function expandAllGroups(page) {
  console.log('  Expanding all ship groups...');

  const clicked = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('span.link'));
    let count = 0;
    for (const link of links) {
      if (link.textContent.trim().toLowerCase() === 'all') {
        link.click();
        count++;
      }
    }
    return count;
  });

  console.log(`  Clicked ${clicked} "all" links`);
  await sleep(TIMING.sleepAfterClickAll);
  await sleep(TIMING.sleepAfterExpand);
}

/**
 * Enable a checkbox by label text
 * @param {Page} page - Puppeteer page
 * @param {string} text - Label text to search for
 */
async function enableCheckbox(page, text) {
  console.log(`  Enabling checkbox: ${text}...`);
  await page.evaluate((searchText) => {
    document.querySelectorAll('label.checkbox').forEach(label => {
      if (label.textContent.toLowerCase().includes(searchText.toLowerCase())) {
        const input = label.querySelector('input');
        if (input && !input.checked) label.click();
      }
    });
  }, text);
  await sleep(TIMING.sleepAfterCheckbox);
}

/**
 * Scrape table data from a page
 * @param {Page} page - Puppeteer page
 * @param {string} url - URL to scrape
 * @param {Object} options - Options {checkboxes: string[]}
 * @returns {Promise<Array>} Array of row objects
 */
async function scrapeTable(page, url, options = {}) {
  console.log(`  Navigating to ${URLS.base + url}...`);
  await page.goto(URLS.base + url, {
    waitUntil: 'networkidle2',
    timeout: TIMING.pageLoadTimeout
  });
  await sleep(TIMING.sleepAfterPageLoad);

  // Expand all groups to show ships
  await expandAllGroups(page);

  // Enable any requested checkboxes
  if (options.checkboxes) {
    for (const checkbox of options.checkboxes) {
      await enableCheckbox(page, checkbox);
    }
    await sleep(TIMING.sleepAfterPageLoad);
  }

  // Wait for table to be present
  try {
    await page.waitForSelector('table', { timeout: 10000 });
  } catch {
    console.log('  No table found on page');
    return [];
  }

  console.log('  Extracting table data...');

  // Extract table data
  const data = await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return [];

    // Get headers from th elements
    const headerCells = table.querySelectorAll('th');
    const headers = Array.from(headerCells).map(th => th.textContent.trim().toLowerCase());

    // Get rows from tbody
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      const obj = {};
      cells.forEach((cell, i) => {
        if (headers[i]) {
          obj[headers[i]] = cell.textContent.trim();
        }
      });
      return obj;
    });
  });

  console.log(`  Extracted ${data.length} rows`);
  return data;
}

/**
 * Parse numeric value from string (handles units like "km", "m/s", "kg", etc.)
 * @param {string} str - String to parse
 * @returns {number} Parsed number
 */
function parseNumeric(str) {
  if (!str) return 0;
  // Remove commas from numbers like "1,321"
  const cleaned = str.replace(/,/g, '');
  const match = cleaned.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

/**
 * Normalize ship name for cross-table matching
 */
function normalizeForMatching(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''ʼ`']/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Main scraper function - scrapes all ship data from shiptool.st
 * @returns {Promise<Object>} Ship data keyed by ship name
 */
export async function scrapeShipData() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // 1. Scrape main params table for ship names, classes, ranges
    // Need to enable "main battery" checkbox to see range column
    console.log('Scraping ship params (main battery)...');
    const paramsData = await scrapeTable(page, URLS.params, { checkboxes: ['main battery'] });

    // Debug: show sample
    if (paramsData.length > 0) {
      console.log('  Sample row keys:', Object.keys(paramsData[0]));
    }

    // Build ship info lookup (name -> {class, range})
    const shipInfo = {};
    for (const row of paramsData) {
      const name = row.ship || row.name;
      const shipClass = (row.class || '').toUpperCase();
      const range = parseNumeric(row.range);
      if (name && shipClass) {
        shipInfo[normalizeForMatching(name)] = {
          originalName: name,
          class: shipClass,
          baseMaxRange: range
        };
      }
    }
    console.log(`  Found ${Object.keys(shipInfo).length} ships with main battery data`);

    // 2. Scrape consumables table for spotter plane availability
    console.log('Scraping consumables...');
    const consumablesData = await scrapeTable(page, URLS.consumables);

    // Build spotter lookup
    const spotterLookup = {};
    for (const row of consumablesData) {
      const name = row.ship || row.name;
      if (name) {
        const spotterValue = parseNumeric(row.spotter);
        spotterLookup[normalizeForMatching(name)] = spotterValue > 0;
      }
    }

    // 3. Scrape shell data tables - these contain the shell properties!
    // Columns: Ship, Tier, Class, Nation, Description, Weight, Damage, Initial speed, Drag coeff., etc.
    console.log('Scraping AP shell data...');
    const apData = await scrapeTable(page, URLS.shells.ap);

    console.log('Scraping HE shell data...');
    const heData = await scrapeTable(page, URLS.shells.he);

    console.log('Scraping SAP shell data...');
    const sapData = await scrapeTable(page, URLS.shells.sap);

    // Debug: show shell table columns
    if (apData.length > 0) {
      console.log('  AP table columns:', Object.keys(apData[0]));
      console.log('  Sample AP row:', JSON.stringify(apData[0]));
    }

    // 4. Build final ship data with shell properties from the tables
    console.log('Processing ship data...');
    const shipData = {};
    let processedCount = 0;
    let skippedCount = 0;

    // Process each shell type table
    const shellTables = [
      { type: 'ap', data: apData },
      { type: 'he', data: heData },
      { type: 'sap', data: sapData }
    ];

    for (const { type, data } of shellTables) {
      for (const row of data) {
        const name = row.ship || row.name;
        if (!name) continue;

        const normalizedName = normalizeForMatching(name);
        const info = shipInfo[normalizedName];

        if (!info) {
          // Ship not in main params table (might be CV/SS)
          continue;
        }

        // Skip submarines and carriers
        if (SKIP_CLASSES.includes(info.class)) {
          continue;
        }

        // Extract shell properties from the table
        // Column names from screenshot: description, weight, initial speed, drag coeff.
        const shellProps = {
          muzzleVelocity: parseNumeric(row['initial speed']),
          mass: parseNumeric(row.weight),
          dragCoefficient: parseNumeric(row['drag coeff.'] || row['drag coeff']),
          caliber: parseNumeric(row.description) // "431 mm" -> 431
        };

        // Validate shell properties
        if (shellProps.muzzleVelocity <= 0 || shellProps.mass <= 0) {
          continue;
        }

        // Initialize ship entry if needed
        if (!shipData[info.originalName]) {
          shipData[info.originalName] = {
            class: info.class,
            nation: row.nation || '',
            baseMaxRange: info.baseMaxRange,
            hasSpotter: spotterLookup[normalizedName] || false,
            shells: {}
          };
          processedCount++;
        }

        // Add shell type
        shipData[info.originalName].shells[type] = shellProps;
      }
    }

    // Log summary
    console.log(`\nProcessed ${processedCount} ships:`);
    let apCount = 0, heCount = 0, sapCount = 0;
    for (const ship of Object.values(shipData)) {
      if (ship.shells.ap) apCount++;
      if (ship.shells.he) heCount++;
      if (ship.shells.sap) sapCount++;
    }
    console.log(`  Ships with AP: ${apCount}`);
    console.log(`  Ships with HE: ${heCount}`);
    console.log(`  Ships with SAP: ${sapCount}`);

    // Debug: show a sample ship
    const sampleName = Object.keys(shipData)[0];
    if (sampleName) {
      console.log(`\nSample ship (${sampleName}):`, JSON.stringify(shipData[sampleName], null, 2));
    }

    return shipData;

  } finally {
    await browser.close();
  }
}

/**
 * Validate scraped data
 */
export function validateScrapedData(shipData) {
  const issues = [];

  for (const [name, data] of Object.entries(shipData)) {
    if (!data.class) issues.push(`${name}: missing class`);
    if (!data.baseMaxRange || data.baseMaxRange <= 0) issues.push(`${name}: invalid baseMaxRange`);

    for (const [shellType, shell] of Object.entries(data.shells)) {
      if (!shell.muzzleVelocity || shell.muzzleVelocity <= 0) {
        issues.push(`${name} ${shellType}: invalid muzzleVelocity`);
      }
      if (!shell.mass || shell.mass <= 0) {
        issues.push(`${name} ${shellType}: invalid mass`);
      }
      if (!shell.dragCoefficient || shell.dragCoefficient <= 0) {
        issues.push(`${name} ${shellType}: invalid dragCoefficient`);
      }
      if (!shell.caliber || shell.caliber <= 0) {
        issues.push(`${name} ${shellType}: invalid caliber`);
      }
    }
  }

  return issues;
}
