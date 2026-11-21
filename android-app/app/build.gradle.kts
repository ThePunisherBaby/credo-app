import java.util.Properties

plugins {
    id("com.android.application")
}

val versionProps = Properties().apply {
    val f = rootProject.file("version.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val appVersionCode = (versionProps.getProperty("VERSION_CODE") ?: "1").trim().toInt()
val appVersionName = (versionProps.getProperty("VERSION_NAME") ?: "1.0.0").trim()

val keystorePath = System.getenv("CREDO_KEYSTORE_PATH")
    ?: "${System.getProperty("user.home")}/.credo-keys/credo-release.jks"
val keystoreFile = file(keystorePath)
val keystorePasswordVal = System.getenv("CREDO_KEYSTORE_PASS") ?: "CredoRelease2026!"
val keyAliasVal = System.getenv("CREDO_KEY_ALIAS") ?: "credo"
val keyPasswordVal = System.getenv("CREDO_KEY_PASS") ?: "CredoRelease2026!"

android {
    namespace = "tech.credoapp.credo"
    compileSdk = 36

    defaultConfig {
        applicationId = "tech.credoapp.credo"
        minSdk = 24
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName

        buildConfigField("String", "CREDO_URL", "\"https://credoapp.tech\"")
        buildConfigField("String", "GITHUB_REPO", "\"ThePunisherBaby/credo-app\"")
    }

    signingConfigs {
        if (keystoreFile.exists()) {
            create("release") {
                storeFile = keystoreFile
                storePassword = keystorePasswordVal
                keyAlias = keyAliasVal
                keyPassword = keyPasswordVal
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (keystoreFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
