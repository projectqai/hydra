const { withAndroidManifest } = require("@expo/config-plugins");

/**
 * Expo config plugin to enable cleartext traffic and enforce landscape orientation
 */
const withCleartextTraffic = (config) => {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    // Add usesCleartextTraffic attribute
    mainApplication.$["android:usesCleartextTraffic"] = "true";

    // Ensure MainActivity is locked to landscape orientation
    const mainActivity = mainApplication.activity?.find(
      (activity) => activity.$["android:name"] === ".MainActivity",
    );

    if (mainActivity) {
      mainActivity.$["android:screenOrientation"] = "sensorLandscape";
    }

    return config;
  });
};

module.exports = withCleartextTraffic;
