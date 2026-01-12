import { PHYSICS, MODIFIERS } from './config.js';

/**
 * Calculate air density at altitude using atmospheric model
 * @param {number} y - Altitude in meters
 * @returns {number} Air density in kg/m^3
 */
export function getAirDensity(y) {
  const T = PHYSICS.t0 - PHYSICS.L * y;                           // temperature at altitude
  const p = PHYSICS.p0 * Math.pow(T / PHYSICS.t0, PHYSICS.gMRL);  // pressure
  const rho = (p * PHYSICS.M) / (PHYSICS.R * T);                  // air density
  return rho;
}

/**
 * Calculate combined drag factor
 * @param {number} Cd - Drag coefficient (unitless)
 * @param {number} caliber - Shell caliber in meters
 * @param {number} mass - Shell mass in kg
 * @returns {number} Combined drag factor
 */
export function getCombinedDrag(Cd, caliber, mass) {
  return 0.5 * Cd * Math.PI * Math.pow(caliber / 2, 2) / mass;
}

/**
 * Calculate derivatives for equations of motion
 * @param {Object} state - Current state {x, y, vx, vy}
 * @param {number} k - Combined drag factor
 * @returns {Object} Derivatives {dx, dy, dvx, dvy}
 */
function derivatives(state, k) {
  const { x, y, vx, vy } = state;
  const speed = Math.sqrt(vx * vx + vy * vy);
  const rho = getAirDensity(y);
  const kRho = k * rho;

  return {
    dx: vx,
    dy: vy,
    dvx: -kRho * vx * speed,
    dvy: -PHYSICS.g - kRho * vy * speed
  };
}

/**
 * Perform one RK4 integration step
 * @param {Object} state - Current state {x, y, vx, vy}
 * @param {number} dt - Time step in seconds
 * @param {number} k - Combined drag factor
 * @returns {Object} New state after integration step
 */
function rk4Step(state, dt, k) {
  const k1 = derivatives(state, k);
  const k2 = derivatives({
    x: state.x + 0.5 * dt * k1.dx,
    y: state.y + 0.5 * dt * k1.dy,
    vx: state.vx + 0.5 * dt * k1.dvx,
    vy: state.vy + 0.5 * dt * k1.dvy
  }, k);
  const k3 = derivatives({
    x: state.x + 0.5 * dt * k2.dx,
    y: state.y + 0.5 * dt * k2.dy,
    vx: state.vx + 0.5 * dt * k2.dvx,
    vy: state.vy + 0.5 * dt * k2.dvy
  }, k);
  const k4 = derivatives({
    x: state.x + dt * k3.dx,
    y: state.y + dt * k3.dy,
    vx: state.vx + dt * k3.dvx,
    vy: state.vy + dt * k3.dvy
  }, k);

  return {
    x: state.x + dt * (k1.dx + 2*k2.dx + 2*k3.dx + k4.dx) / 6,
    y: state.y + dt * (k1.dy + 2*k2.dy + 2*k3.dy + k4.dy) / 6,
    vx: state.vx + dt * (k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx) / 6,
    vy: state.vy + dt * (k1.dvy + 2*k2.dvy + 2*k3.dvy + k4.dvy) / 6
  };
}

/**
 * Simulate shell trajectory
 * @param {number} launchAngleDeg - Launch angle in degrees
 * @param {Object} shellParams - Shell parameters {muzzleVelocity, caliber, mass, dragCoefficient}
 * @returns {Object} Trajectory result {range, flightTime, adjustedFlightTime, impactAngle, impactVelocity}
 */
export function simulateTrajectory(launchAngleDeg, shellParams) {
  const { muzzleVelocity, caliber, mass, dragCoefficient } = shellParams;
  const k = getCombinedDrag(dragCoefficient, caliber / 1000, mass); // caliber mm -> m
  const angleRad = launchAngleDeg * Math.PI / 180;

  let state = {
    x: 0,
    y: 0,
    vx: muzzleVelocity * Math.cos(angleRad),
    vy: muzzleVelocity * Math.sin(angleRad)
  };

  const dt = 0.02; // time step (seconds)
  let time = 0;

  while (state.y >= 0 && time < 120) {
    state = rk4Step(state, dt, k);
    time += dt;
  }

  return {
    range: state.x,                                              // horizontal distance (m)
    flightTime: time,                                            // raw flight time (s)
    adjustedFlightTime: time / PHYSICS.timeMultiplier,           // game-adjusted time
    impactAngle: Math.atan2(-state.vy, state.vx) * 180 / Math.PI, // degrees
    impactVelocity: Math.sqrt(state.vx * state.vx + state.vy * state.vy)
  };
}

/**
 * Find launch angle for target range using binary search
 * @param {number} targetRangeMeters - Target range in meters
 * @param {Object} shellParams - Shell parameters
 * @returns {number} Launch angle in degrees
 */
export function findLaunchAngle(targetRangeMeters, shellParams) {
  let low = 0, high = 45;

  while (high - low > 0.001) {
    const mid = (low + high) / 2;
    const result = simulateTrajectory(mid, shellParams);
    if (result.range < targetRangeMeters) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

/**
 * Get ballistics at a specific range
 * @param {number} targetRangeKm - Target range in kilometers
 * @param {Object} shellParams - Shell parameters
 * @returns {Object} Ballistics data {flightTime, impactAngle, impactVelocity}
 */
export function getBallisticsAtRange(targetRangeKm, shellParams) {
  const targetRangeM = targetRangeKm * 1000;
  const launchAngle = findLaunchAngle(targetRangeM, shellParams);
  const result = simulateTrajectory(launchAngle, shellParams);

  return {
    flightTime: result.adjustedFlightTime,  // Use game-adjusted time
    impactAngle: result.impactAngle,
    impactVelocity: result.impactVelocity
  };
}

/**
 * Calculate modified range based on ship class and modifiers
 * @param {number} baseMaxRange - Base max range in km
 * @param {string} shipClass - Ship class (BB, CA, CB, CL, DD, SS, CV)
 * @param {boolean} hasSpotter - Whether ship has spotter plane
 * @param {string} shipName - Ship name for unique upgrades
 * @param {string} nation - Ship nation (e.g., 'USA', 'Japan', etc.)
 * @returns {number} Modified max range in km
 */
export function calculateModifiedRange(baseMaxRange, shipClass, hasSpotter, shipName, nation) {
  let maxRange = baseMaxRange;

  // Apply Artillery Plotting Room Mod 1 for USN BBs (+16%)
  if (nation === 'U.S.A.' && shipClass === 'BB') {
    maxRange = baseMaxRange * MODIFIERS.aprm1Multiplier;
  }

  // Apply class-specific modifiers
  if (shipClass === 'DD') {
    // All destroyers get AFT (+20%)
    maxRange = baseMaxRange * MODIFIERS.aftMultiplier;
  } else if (['BB', 'CA', 'CB', 'CL'].includes(shipClass) && hasSpotter) {
    // BBs/CAs/CBs/CLs with spotter plane (+20%)
    maxRange *= MODIFIERS.spotterMultiplier;
  }

  // Apply unique upgrade modifier if applicable
  const uniqueMultiplier = MODIFIERS.uniqueUpgrades?.[shipName];
  if (uniqueMultiplier) {
    maxRange *= uniqueMultiplier;
  }

  return maxRange;
}
