import { sin, cos, tan, abs } from './core';
import { tau } from './circle';
import { distance2d } from './distance';
import {
    vradial,
    vsub,
    vlen,
    point_in_area,
    distance_to_poly,
    area_to_poly
} from './vector';
import { PHYSICS_CONSTANTS } from '../constants/globalConstants';
import {
    kn_ms,
    degreesToRadians,
    radiansToDegrees
} from '../utilities/unitConverters';

/**
 * @function calcTurnRadius
 * @param speed {number} currentSpeed of an aircraft
 * @param bankAngle {number} bank angle of an aircraft
 * @return {number}
 */
export const calcTurnRadius = (speed, bankAngle) => {
    return (speed * speed) / (PHYSICS_CONSTANTS.GRAVITATIONAL_MAGNITUDE * tan(bankAngle));
};

/**
 * @function calcTurnInitiationDistance
 * @param speed {number}            currentSpeed of an aircraft
 * @param bankAngle {number}        bank angle of an aircraft
 * @param courseChange {number}
 * @return {number}
 */
export const calcTurnInitiationDistance = (speed, bankAngle, courseChange) => {
    const turnRadius = calcTurnRadius(speed, bankAngle);

    return turnRadius * tan(courseChange / 2) + speed;
};

/**
 * Returns the bearing from `startPosition` to `endPosition`
 * @function bearingToPoint
 * @param startPosition {array}     positional array, start point
 * @param endPosition {array}       positional array, end point
 * @return {number}
 */
export const bearingToPoint = (startPosition, endPosition) => vradial(vsub(endPosition, startPosition));

// TODO: this may be better suited to live in an Aircraft model somewhere.
// TODO: This is goofy like this. Should be changed to accept (PositionModel, PositionModel, heading)
/**
 * Returns an offset array showing how far [fwd/bwd, left/right] 'aircraft' is of 'target'
 *
 * @param aircraft {Aircraft}           the aircraft in question
 * @param target {array}                positional array of the targeted position [x,y]
 * @param headingThruTarget {number}    (optional) The heading the aircraft should
 *                                      be established on when passing the target.
 *                                      Default value is the aircraft's heading.
 * @returns {array} with two elements:  retval[0] is the lateral offset, in km
 *                                      retval[1] is the longitudinal offset, in km
 *                                      retval[2] is the hypotenuse (straight-line distance), in km
 */
export const getOffset = (aircraft, target, headingThruTarget = null) => {
    if (!headingThruTarget) {
        headingThruTarget = aircraft.heading;
    }

    const offset = [0, 0, 0];
    const vector = vsub(target, aircraft.position.relativePosition); // vector from aircraft pointing to target
    const bearingToTarget = vradial(vector);

    offset[2] = vlen(vector);
    offset[0] = offset[2] * sin(headingThruTarget - bearingToTarget);
    offset[1] = offset[2] * cos(headingThruTarget - bearingToTarget);

    return offset;
};

// TODO: This has been replaced by `DynamicPositionModel.generateDynamicPositionFromBearingAndDistance()`.
// Please replace all usages of this function with that, and then delete this helper function.
/**
 * Get new position by fix-radial-distance method
 *
 * @param {array} fix       positional array of start point, in decimal-degrees [lat,lon]
 * @param {number} radial   heading to project along, in radians
 * @param {number} dist     distance to project, in nm
 * @returns {array}         location of the projected fix, in decimal-degrees [lat,lon]
 */
export const fixRadialDist = (fix, radial, dist) => {
    // FIXME: if fix is a FixModel, there may already be a method for this. if there isnt there should be. `fix.positionInRadians`
    // convert GPS coordinates to radians
    fix = [
        degreesToRadians(fix[0]),
        degreesToRadians(fix[1])
    ];

    const R = PHYSICS_CONSTANTS.EARTH_RADIUS_NM;
    // TODO: abstract these two calculations to functions
    const lat2 = Math.asin(sin(fix[0]) * cos(dist / R) + cos(fix[0]) * sin(dist / R) * cos(radial));
    const lon2 = fix[1] + Math.atan2(
        sin(radial) * sin(dist / R) * cos(fix[0]),
        cos(dist / R) - sin(fix[0]) * sin(lat2)
    );

    return [
        radiansToDegrees(lat2),
        radiansToDegrees(lon2)
    ];
};

/**
 *
 * @function isWithinAirspace
 * @param airport {AirportModel}
 * @param  pos {array}
 * @return {boolean}
 */
export const isWithinAirspace = (airport, pos) => {
    const perim = airport.perimeter;

    if (perim) {
        return point_in_area(pos, perim);
    }

    return distance2d(pos, airport.position.relativePosition) <= airport.ctr_radius;
};

/**
 *
 * @function calculateDistanceToBoundary
 * @param airport {AirportModel}
 * @param pos {array}
 * @return {boolean}
 */
export const calculateDistanceToBoundary = (airport, pos) => {
    const perim = airport.perimeter;

    if (perim) {
        // km
        return distance_to_poly(pos, area_to_poly(perim));
    }

    return abs(distance2d(pos, airport.position.relativePosition) - airport.ctr_radius);
};


/**
 * @function _calculateNominalNewCourse
 * @param nextWaypointPosition {array}
 * @param currentWaypointPosition {array}
 * @return nominalNewCourse {number}
 * */
const _calculateNominalNewCourse = (nextWaypointPosition, currentWaypointPosition) => {
    let nominalNewCourse = vradial(vsub(nextWaypointPosition, currentWaypointPosition));

    if (nominalNewCourse < 0) {
        // TODO: what is this doing? this should go in a new method.
        nominalNewCourse += tau();
    }

    return nominalNewCourse;
};

/**
 * @function _calculateCourseChangeInRadians
 * @param currentHeading {number}
 * @param nominalNewCourse {number}
 * @return {number}
 */
const _calculateCourseChangeInRadians = (currentHeading, nominalNewCourse) => {
    let courseChange = abs(radiansToDegrees(currentHeading) - radiansToDegrees(nominalNewCourse));

    if (courseChange > 180) {
        courseChange = 360 - courseChange;
    }

    return degreesToRadians(courseChange);
};

/**
 * Calculate the turn initiation distance for an aircraft to navigate between two fixes.
 *
 * References:
 * - http://www.ohio.edu/people/uijtdeha/ee6900_fms_00_overview.pdf, Fly-by waypoint
 * - The Avionics Handbook, ch 15
 *
 * @function aircraft_turn_initiation_distance
 * @param aircraft {AircraftInstanceModel}
 * @param fix
 */
export const calculateTurnInitiaionDistance = (aircraft, currentWaypointPosition) => {
    let currentHeading = aircraft.heading;
    const nominalBankAngleDegrees = 25;
    const speed = kn_ms(aircraft.speed);
    const bankAngle = degreesToRadians(nominalBankAngleDegrees);

    if (!aircraft.fms.hasNextWaypoint()) {
        return 0;
    }

    if (currentHeading < 0) {
        currentHeading += tau();
    }

    const nominalNewCourse = _calculateNominalNewCourse(
        aircraft.fms.getNextWaypointPosition(),
        currentWaypointPosition
    );
    const courseChange = _calculateCourseChangeInRadians(currentHeading, nominalNewCourse);
    // meters, bank establishment in 1s
    const turnInitiationDistance = calcTurnInitiationDistance(speed, bankAngle, courseChange);

    // convert m to km
    return turnInitiationDistance / 1000;
};
