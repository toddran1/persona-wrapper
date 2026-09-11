const { withGradleProperties, withProjectBuildGradle } = require("@expo/config-plugins");

const KOTLIN_VERSION = "2.3.0";
const GRADLE_JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8";
const KOTLIN_DAEMON_JVM_ARGS = "-Xmx2048m -XX:MaxMetaspaceSize=1024m";
const unpinnedKotlinClasspath = "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')";
const pinnedKotlinClasspath = `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}')`;

function setGradleProperty(properties, key, value) {
  const existing = properties.find((entry) => entry.type === "property" && entry.key === key);
  if (existing) {
    existing.value = value;
    return;
  }
  properties.push({ type: "property", key, value });
}

/**
 * expo-build-properties writes android.kotlinVersion for module configuration,
 * but React Native's generated root classpath has no Kotlin version. Pin the
 * compiler too, otherwise Gradle can select React Native's Kotlin 2.1 plugin
 * while dependencies such as Google Mobile Ads use Kotlin 2.3 metadata.
 */
module.exports = function withKotlinCompilerVersion(config) {
  const withPinnedCompiler = withProjectBuildGradle(config, (gradleConfig) => {
    const { contents } = gradleConfig.modResults;

    if (contents.includes(pinnedKotlinClasspath)) return gradleConfig;
    if (!contents.includes(unpinnedKotlinClasspath)) {
      throw new Error("Unable to locate the Kotlin Gradle plugin classpath in android/build.gradle.");
    }

    gradleConfig.modResults.contents = contents.replace(unpinnedKotlinClasspath, pinnedKotlinClasspath);
    return gradleConfig;
  });

  return withGradleProperties(withPinnedCompiler, (gradleConfig) => {
    setGradleProperty(gradleConfig.modResults, "org.gradle.jvmargs", GRADLE_JVM_ARGS);
    setGradleProperty(gradleConfig.modResults, "kotlin.daemon.jvmargs", KOTLIN_DAEMON_JVM_ARGS);
    setGradleProperty(gradleConfig.modResults, "org.gradle.workers.max", "2");
    return gradleConfig;
  });
};
