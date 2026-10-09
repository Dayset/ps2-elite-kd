/**
 * Site-wide settings for the browser.
 *
 * CENSUS_SERVICE_ID: Daybreak Census service ID (without the "s:" prefix).
 * Registered ID for this site (public client-side value; Daybreak expects
 * client apps to ship it). "example" is Daybreak's casual ID, throttled to
 * 10 requests/minute per IP; it is only the fallback if this is emptied.
 */
export const CENSUS_SERVICE_ID = "daysetps2legends";
