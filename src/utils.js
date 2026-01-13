import { SHIP_NAME_MAPPINGS, PITCH } from './config.js';

/**
 * Normalize ship name for config output
 * @param {string} name - Ship name from shiptool.st
 * @returns {string} Normalized ship name
 */
export function normalizeShipName(name) {
  let weaponName = String(name).trim();

  // Apply suffix transformations (Black, Golden variants)
  for (const { suffix, prefix, trim } of SHIP_NAME_MAPPINGS.suffixes) {
    if (weaponName.endsWith(suffix)) {
      weaponName = prefix + weaponName.slice(0, -trim);
      break;
    }
  }

  // Apply exact name replacements
  if (SHIP_NAME_MAPPINGS.exact[weaponName]) {
    weaponName = SHIP_NAME_MAPPINGS.exact[weaponName];
  }

  // Remove diacritics (i->i, e->e, etc.)
  weaponName = weaponName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Replace special chars: ' -> _, . -> removed, - -> _, spaces -> _
  weaponName = weaponName
    .replace(/'/g, '_')
    .replace(/\./g, '')
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');

  // Apply prefix transformations (e.g., AL_ -> Azur_)
  for (const { from, to } of SHIP_NAME_MAPPINGS.prefixes) {
    if (weaponName.startsWith(from)) {
      weaponName = to + weaponName.slice(from.length);
      break;
    }
  }

  return weaponName;
}

/**
 * Calculate BulletSpeed factor
 * @param {number} rangeKm - Range in kilometers
 * @param {number} flightTime - Flight time in seconds
 * @param {number} impactAngleDeg - Impact angle in degrees
 * @returns {number|null} BulletSpeed factor or null if invalid
 */
export function calculateFactor(rangeKm, flightTime, impactAngleDeg) {
  if (rangeKm <= 0 || flightTime <= 0) return null;
  const angleRad = (impactAngleDeg * Math.PI) / 180;
  const cosAngle = Math.cos(angleRad);

  // Reject angles >= 85 degrees
  if (cosAngle < 0.0872) return null;

  const rawFactor = (rangeKm * 1000 / (flightTime * cosAngle)) / 32;
  return Math.round(rawFactor * 1000) / 1000;
}

/**
 * Calculate converted range for config file
 * @param {number} rangeKm - Range in kilometers
 * @returns {number} Converted range value
 */
export function calculateConvertedRange(rangeKm) {
  return Math.round((rangeKm * 1000) / 30.3);
}

/**
 * Generate weapon config XML for a ship
 * @param {string} shipName - Normalized ship name
 * @param {string} shellType - Shell type (ap, he, sap)
 * @param {Object} rangeData - Range data {halfRange, halfFactor, maxRange, maxFactor}
 * @param {string} shipClass - Ship class (BB, CA, CB, CL, DD)
 * @param {string} originalShipName - Original ship name for override lookup
 * @returns {string} Weapon config XML
 */
export function generateWeaponConfig(shipName, shellType, rangeData, shipClass, originalShipName) {
  // Check for ship-specific override first
  const shipOverride = PITCH.shipOverrides?.[originalShipName]?.[shellType];
  const pitch = shipOverride !== undefined
    ? shipOverride
    : (shellType === 'ap')
      ? (PITCH.ap[shipClass] ?? PITCH.ap.default)
      : (PITCH.other[shipClass] ?? PITCH.other.default);

  const halfConv = calculateConvertedRange(rangeData.halfRange);
  const maxConv = calculateConvertedRange(rangeData.maxRange + 0.5); // 0.5km buffer
  const upperPitch = (shellType === 'ap') ? 0 : pitch;

  return `<Weapon ${shipName}>
\t<FireMode>
\t\t<HitLocations>
\t\t\t<HitData>
\t\t\t\t<HitZone 2></HitZone>
\t\t\t\t<MinPlayerSpeed -1></MinPlayerSpeed>
\t\t\t\t<MaxPlayerSpeed -1></MaxPlayerSpeed>
\t\t\t\t<MinTargetSpeed -1></MinTargetSpeed>
\t\t\t\t<MaxTargetSpeed -1></MaxTargetSpeed>
\t\t\t\t<MinTargetHealth -1></MinTargetHealth>
\t\t\t\t<MaxTargetHealth -1></MaxTargetHealth>
\t\t\t\t<MinPlayerZoom -1></MinPlayerZoom>
\t\t\t\t<MaxPlayerZoom -1></MaxPlayerZoom>
\t\t\t\t<MinRange -1></MinRange>
\t\t\t\t<MaxRange ${halfConv}></MaxRange>
\t\t\t\t<MinAngle -1></MinAngle>
\t\t\t\t<MaxAngle -1></MaxAngle>
\t\t\t</HitData>
\t\t</HitLocations>
\t\t<Valid True></Valid>
\t\t<CanHitPlayer True></CanHitPlayer>
\t\t<CanHitVehicle True></CanHitVehicle>
\t\t<CanHitArmor True></CanHitArmor>
\t\t<CanHitPlane True></CanHitPlane>
\t\t<CanHitHeli True></CanHitHeli>
\t\t<CanHitBoat True></CanHitBoat>
\t\t<BulletSpeed ${rangeData.halfFactor.toFixed(2)}></BulletSpeed>
\t\t<BulletDrop -1></BulletDrop>
\t\t<MinZoomLevel -1></MinZoomLevel>
\t\t<AutoZoom False></AutoZoom>
\t\t<Trigger 0></Trigger>
\t\t<BulletPlayerSpeedScale 0.0></BulletPlayerSpeedScale>
\t\t<BulletTargetSpeedScale 1.0></BulletTargetSpeedScale>
\t\t<PitchToAdd ${pitch}></PitchToAdd>
\t\t<YawToAdd 0></YawToAdd>
\t</FireMode>
\t<FireMode>
\t\t<HitLocations>
\t\t\t<HitData>
\t\t\t\t<HitZone 2></HitZone>
\t\t\t\t<MinPlayerSpeed -1></MinPlayerSpeed>
\t\t\t\t<MaxPlayerSpeed -1></MaxPlayerSpeed>
\t\t\t\t<MinTargetSpeed -1></MinTargetSpeed>
\t\t\t\t<MaxTargetSpeed -1></MaxTargetSpeed>
\t\t\t\t<MinTargetHealth -1></MinTargetHealth>
\t\t\t\t<MaxTargetHealth -1></MaxTargetHealth>
\t\t\t\t<MinPlayerZoom -1></MinPlayerZoom>
\t\t\t\t<MaxPlayerZoom -1></MaxPlayerZoom>
\t\t\t\t<MinRange ${halfConv}></MinRange>
\t\t\t\t<MaxRange ${maxConv}></MaxRange>
\t\t\t\t<MinAngle -1></MinAngle>
\t\t\t\t<MaxAngle -1></MaxAngle>
\t\t\t</HitData>
\t\t</HitLocations>
\t\t<Valid True></Valid>
\t\t<CanHitPlayer True></CanHitPlayer>
\t\t<CanHitVehicle True></CanHitVehicle>
\t\t<CanHitArmor True></CanHitArmor>
\t\t<CanHitPlane True></CanHitPlane>
\t\t<CanHitHeli True></CanHitHeli>
\t\t<CanHitBoat True></CanHitBoat>
\t\t<BulletSpeed ${rangeData.maxFactor.toFixed(2)}></BulletSpeed>
\t\t<BulletDrop -1></BulletDrop>
\t\t<MinZoomLevel -1></MinZoomLevel>
\t\t<AutoZoom False></AutoZoom>
\t\t<Trigger 0></Trigger>
\t\t<BulletPlayerSpeedScale 0.0></BulletPlayerSpeedScale>
\t\t<BulletTargetSpeedScale 1.0></BulletTargetSpeedScale>
\t\t<PitchToAdd ${upperPitch}></PitchToAdd>
\t\t<YawToAdd 0></YawToAdd>
\t</FireMode>
</Weapon>`;
}

/**
 * Assign shell configs to output files
 * @param {string} shipName - Normalized ship name
 * @param {Object} shellResults - Shell results {he, ap, sap}
 * @param {string} shipClass - Ship class
 * @param {string} originalShipName - Original ship name for override lookup
 * @returns {Object} {heConfigs, apConfigs} arrays
 */
export function assignToFiles(shipName, shellResults, shipClass, originalShipName) {
  const hasHE = 'he' in shellResults;
  const hasAP = 'ap' in shellResults;
  const hasSAP = 'sap' in shellResults;

  const heConfigs = [];  // Goes to HE.cfg
  const apConfigs = [];  // Goes to AP.cfg

  // HE.cfg: HE if available, else SAP, else AP as fallback
  if (hasHE) {
    heConfigs.push(generateWeaponConfig(shipName, 'he', shellResults.he, shipClass, originalShipName));
  } else if (hasSAP) {
    heConfigs.push(generateWeaponConfig(shipName, 'sap', shellResults.sap, shipClass, originalShipName));
  } else if (hasAP) {
    heConfigs.push(generateWeaponConfig(shipName, 'ap', shellResults.ap, shipClass, originalShipName));
  }

  // AP.cfg: AP always, SAP only if ship has HE
  if (hasAP) {
    apConfigs.push(generateWeaponConfig(shipName, 'ap', shellResults.ap, shipClass, originalShipName));
  }
  if (hasSAP && hasHE) {
    apConfigs.push(generateWeaponConfig(shipName, 'sap', shellResults.sap, shipClass, originalShipName));
  }

  return { heConfigs, apConfigs };
}
