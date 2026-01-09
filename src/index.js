import fs from 'fs/promises';
import path from 'path';
import { scrapeShipData, validateScrapedData } from './scraper.js';
import { getBallisticsAtRange, calculateModifiedRange } from './physics.js';
import { calculateFactor, normalizeShipName, assignToFiles } from './utils.js';

const CONFIGS_DIR = 'configs';

/**
 * Main entry point
 */
async function main() {
  console.log('=== WoWS Ballistics Calculator ===\n');

  // 1. Scrape ship data
  console.log('Phase 1: Scraping ship data from shiptool.st...\n');
  const shipData = await scrapeShipData();

  // Validate scraped data
  const issues = validateScrapedData(shipData);
  if (issues.length > 0) {
    console.warn('\nData validation issues:');
    issues.forEach(issue => console.warn(`  - ${issue}`));
    console.warn('');
  }

  // 2. Calculate ballistics for each ship
  console.log('\nPhase 2: Calculating ballistics...\n');
  const results = {};
  let successCount = 0;
  let errorCount = 0;

  for (const [shipName, data] of Object.entries(shipData)) {
    try {
      const modifiedRange = calculateModifiedRange(
        data.baseMaxRange,
        data.class,
        data.hasSpotter,
        shipName
      );

      results[shipName] = {
        class: data.class,
        baseMaxRange: data.baseMaxRange,
        modifiedRange,
        hasSpotter: data.hasSpotter,
        shells: {}
      };

      for (const [shellType, shellProps] of Object.entries(data.shells)) {
        const halfRange = modifiedRange / 2;

        // Calculate ballistics at half range
        const halfBallistics = getBallisticsAtRange(halfRange, shellProps);
        const halfFactor = calculateFactor(halfRange, halfBallistics.flightTime, halfBallistics.impactAngle);

        // Calculate ballistics at max range
        const maxBallistics = getBallisticsAtRange(modifiedRange, shellProps);
        const maxFactor = calculateFactor(modifiedRange, maxBallistics.flightTime, maxBallistics.impactAngle);

        if (halfFactor !== null && maxFactor !== null) {
          results[shipName].shells[shellType] = {
            halfRange,
            halfFactor,
            halfFlightTime: halfBallistics.flightTime,
            halfImpactAngle: halfBallistics.impactAngle,
            maxRange: modifiedRange,
            maxFactor,
            maxFlightTime: maxBallistics.flightTime,
            maxImpactAngle: maxBallistics.impactAngle,
            shellProps
          };
        } else {
          console.warn(`Invalid factor calculated for ${shipName} (${shellType})`);
        }
      }

      if (Object.keys(results[shipName].shells).length > 0) {
        successCount++;
        console.log(`  [OK] ${shipName}: ${Object.keys(results[shipName].shells).join(', ')}`);
      } else {
        delete results[shipName];
        errorCount++;
        console.warn(`  [SKIP] ${shipName}: No valid shell configs`);
      }

    } catch (err) {
      errorCount++;
      console.error(`  [ERROR] ${shipName}: ${err.message}`);
    }
  }

  console.log(`\nCalculated ballistics for ${successCount} ships (${errorCount} errors)`);

  // 3. Generate config files
  console.log('\nPhase 3: Generating config files...\n');

  // Ensure configs directory exists
  await fs.mkdir(CONFIGS_DIR, { recursive: true });

  const heConfigs = [];
  const apConfigs = [];

  for (const [shipName, shipResult] of Object.entries(results)) {
    const normalizedName = normalizeShipName(shipName);

    // Build shell results in the format expected by assignToFiles
    const shellResults = {};
    for (const [shellType, shellData] of Object.entries(shipResult.shells)) {
      shellResults[shellType] = {
        halfRange: shellData.halfRange,
        halfFactor: shellData.halfFactor,
        maxRange: shellData.maxRange,
        maxFactor: shellData.maxFactor
      };
    }

    const { heConfigs: he, apConfigs: ap } = assignToFiles(
      normalizedName,
      shellResults,
      shipResult.class
    );

    heConfigs.push(...he);
    apConfigs.push(...ap);
  }

  // Write config files
  const heFilePath = path.join(CONFIGS_DIR, 'HE.cfg');
  const apFilePath = path.join(CONFIGS_DIR, 'AP.cfg');
  const summaryFilePath = path.join(CONFIGS_DIR, '_summary.json');

  await fs.writeFile(heFilePath, heConfigs.join('\n\n'), 'utf-8');
  console.log(`  Written: ${heFilePath} (${heConfigs.length} weapons)`);

  await fs.writeFile(apFilePath, apConfigs.join('\n\n'), 'utf-8');
  console.log(`  Written: ${apFilePath} (${apConfigs.length} weapons)`);

  await fs.writeFile(summaryFilePath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`  Written: ${summaryFilePath}`);

  console.log('\n=== Done! ===');
}

// Run main
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
