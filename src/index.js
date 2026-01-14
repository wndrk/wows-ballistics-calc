import fs from 'fs/promises';
import path from 'path';
import { scrapeShipData, validateScrapedData, scrapeSonarData } from './scraper.js';
import { getBallisticsAtRange, calculateModifiedRange } from './physics.js';
import { calculateFactor, normalizeShipName, assignToFiles, generateSonarConfig } from './utils.js';

const CONFIGS_DIR = 'configs';

/**
 * Main entry point
 */
async function main() {
  console.log('=== WoWS Ballistics Calculator ===\n');

  // 1. Scrape ship data (surface ships and submarines)
  console.log('Phase 1: Scraping ship data from shiptool.st...\n');
  const shipData = await scrapeShipData();

  // Validate scraped data
  const issues = validateScrapedData(shipData);
  if (issues.length > 0) {
    console.warn('\nData validation issues:');
    issues.forEach(issue => console.warn(`  - ${issue}`));
    console.warn('');
  }

  // 1b. Scrape submarine sonar data
  console.log('\nPhase 1b: Scraping submarine sonar data...\n');
  const sonarData = await scrapeSonarData();

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
        shipName,
        data.nation
      );

      results[shipName] = {
        class: data.class,
        nation: data.nation,
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
    // Skip submarines - they only get sonar configs, not shell configs
    if (shipResult.class === 'SS') continue;

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

    // Get caliber from any shell type (all same gun)
    const caliber = Object.values(shipResult.shells)[0]?.shellProps?.caliber;

    const { heConfigs: he, apConfigs: ap } = assignToFiles(
      normalizedName,
      shellResults,
      shipResult.class,
      shipName,
      caliber
    );

    heConfigs.push(...he);
    apConfigs.push(...ap);
  }

  // 3b. Generate submarine sonar configs (append to HE.cfg)
  const sonarConfigs = [];
  const sonarResults = {};

  for (const [shipName, sonar] of Object.entries(sonarData)) {
    const normalizedName = normalizeShipName(shipName);
    const config = generateSonarConfig(normalizedName, sonar.bulletSpeed, sonar.range);
    sonarConfigs.push(config);

    // Add to sonar results for summary
    sonarResults[shipName] = {
      class: sonar.class,
      nation: sonar.nation,
      range: sonar.range,
      waveSpeed: sonar.waveSpeed,
      bulletSpeed: sonar.bulletSpeed
    };

    console.log(`  [SONAR] ${shipName}: waveSpeed=${sonar.waveSpeed} m/s, bulletSpeed=${sonar.bulletSpeed.toFixed(2)}`);
  }

  // Combine HE configs with sonar configs
  const allHeConfigs = [...heConfigs, ...sonarConfigs];

  // Write config files
  const heFilePath = path.join(CONFIGS_DIR, 'HE.cfg');
  const apFilePath = path.join(CONFIGS_DIR, 'AP.cfg');
  const summaryFilePath = path.join(CONFIGS_DIR, '_summary.json');

  await fs.writeFile(heFilePath, allHeConfigs.join('\n\n'), 'utf-8');
  console.log(`  Written: ${heFilePath} (${heConfigs.length} shell weapons + ${sonarConfigs.length} sonar weapons)`);

  await fs.writeFile(apFilePath, apConfigs.join('\n\n'), 'utf-8');
  console.log(`  Written: ${apFilePath} (${apConfigs.length} weapons)`);

  // Include sonar data in summary
  const fullSummary = {
    ships: results,
    submarines: sonarResults
  };

  await fs.writeFile(summaryFilePath, JSON.stringify(fullSummary, null, 2), 'utf-8');
  console.log(`  Written: ${summaryFilePath}`);

  console.log('\n=== Done! ===');
}

// Run main
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
