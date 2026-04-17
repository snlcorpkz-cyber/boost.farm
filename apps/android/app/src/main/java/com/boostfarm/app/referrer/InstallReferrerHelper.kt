package com.boostfarm.app.referrer

import android.content.Context
import android.net.Uri
import android.util.Log
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener

/**
 * Fetches the Google Play Install Referrer exactly once per install and caches
 * the result in SharedPreferences. The web layer then reads it via the JS
 * bridge during signup so the referral is attributed automatically — no manual
 * code entry, no deep-link requirements on the web page.
 *
 * Play sends us a URL-encoded query string like:
 *     utm_source=app&utm_medium=organic&utm_campaign=...&ref=CODE123
 * We parse out the `ref` parameter; any extra UTM keys are preserved so
 * marketing attribution can be layered on top later.
 *
 * Design notes:
 *  - The InstallReferrerClient connection is cheap but not free; we only open
 *    it the first time we successfully read the payload, store it, and never
 *    touch the API again for this install.
 *  - Errors (service unavailable, API not supported, feature not available)
 *    are swallowed: we simply won't have a referrer code and the user can
 *    enter one manually like before.
 */
object InstallReferrerHelper {
    private const val TAG = "InstallReferrer"
    private const val PREFS = "install_referrer"
    private const val KEY_PROCESSED = "processed"
    private const val KEY_REF_CODE = "ref_code"
    private const val KEY_RAW = "raw"
    private const val KEY_UTM_SOURCE = "utm_source"
    private const val KEY_UTM_MEDIUM = "utm_medium"
    private const val KEY_UTM_CAMPAIGN = "utm_campaign"
    private const val KEY_CLICK_TS = "click_ts"
    private const val KEY_INSTALL_TS = "install_ts"

    /**
     * Kicks off the one-time referrer fetch. Safe to call on every cold start —
     * becomes a no-op after the first successful read. Should run off the main
     * thread implicitly (the API is async).
     */
    fun fetchOnce(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_PROCESSED, false)) return

        val appContext = context.applicationContext
        val client: InstallReferrerClient = InstallReferrerClient.newBuilder(appContext).build()

        client.startConnection(object : InstallReferrerStateListener {
            override fun onInstallReferrerSetupFinished(responseCode: Int) {
                try {
                    when (responseCode) {
                        InstallReferrerClient.InstallReferrerResponse.OK -> {
                            val details = client.installReferrer
                            val raw = details.installReferrer ?: ""
                            val parsed = parseReferrer(raw)
                            prefs.edit()
                                .putBoolean(KEY_PROCESSED, true)
                                .putString(KEY_RAW, raw)
                                .putString(KEY_REF_CODE, parsed.refCode)
                                .putString(KEY_UTM_SOURCE, parsed.utmSource)
                                .putString(KEY_UTM_MEDIUM, parsed.utmMedium)
                                .putString(KEY_UTM_CAMPAIGN, parsed.utmCampaign)
                                .putLong(KEY_CLICK_TS, details.referrerClickTimestampSeconds)
                                .putLong(KEY_INSTALL_TS, details.installBeginTimestampSeconds)
                                .apply()
                            Log.i(TAG, "referrer captured: code=${parsed.refCode} src=${parsed.utmSource}")
                        }

                        InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED,
                        InstallReferrerClient.InstallReferrerResponse.SERVICE_UNAVAILABLE -> {
                            // Don't mark processed — retry on next app launch.
                            Log.w(TAG, "referrer API not available: $responseCode")
                        }

                        else -> {
                            // Any other response: flag as processed so we don't loop.
                            prefs.edit().putBoolean(KEY_PROCESSED, true).apply()
                            Log.w(TAG, "referrer API returned: $responseCode")
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "referrer fetch failed", e)
                } finally {
                    try { client.endConnection() } catch (_: Exception) { /* ignore */ }
                }
            }

            override fun onInstallReferrerServiceDisconnected() {
                // Library is auto-reconnecting when needed on next call; nothing to do.
            }
        })
    }

    /**
     * Returns a JSON-serializable map of everything we know about the install
     * referrer. Shape matches what the web layer expects via the JS bridge.
     */
    fun snapshot(context: Context): Map<String, Any?> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return mapOf(
            "refCode" to prefs.getString(KEY_REF_CODE, null),
            "raw" to prefs.getString(KEY_RAW, null),
            "utmSource" to prefs.getString(KEY_UTM_SOURCE, null),
            "utmMedium" to prefs.getString(KEY_UTM_MEDIUM, null),
            "utmCampaign" to prefs.getString(KEY_UTM_CAMPAIGN, null),
            "clickTs" to prefs.getLong(KEY_CLICK_TS, 0L),
            "installTs" to prefs.getLong(KEY_INSTALL_TS, 0L),
            "processed" to prefs.getBoolean(KEY_PROCESSED, false),
        )
    }

    /**
     * Marks the referrer as consumed after the server has successfully applied
     * it. Prevents the same referrer from being re-used on e.g. a second signup
     * from the same device. Called from the JS bridge once the backend confirms
     * the referral bonus has been credited.
     */
    fun markConsumed(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_REF_CODE)
            .remove(KEY_RAW)
            .apply()
    }

    data class ParsedReferrer(
        val refCode: String?,
        val utmSource: String?,
        val utmMedium: String?,
        val utmCampaign: String?,
    )

    /**
     * Extracts our `ref` parameter + any UTM markers from the raw referrer
     * string. Play passes us either a bare key=value query string or something
     * URL-encoded like `utm_source%3Dapp%26ref%3DABC`. `Uri.parse` copes with
     * both formats once we prepend a scheme.
     */
    internal fun parseReferrer(raw: String): ParsedReferrer {
        if (raw.isBlank()) return ParsedReferrer(null, null, null, null)
        return try {
            val uri = Uri.parse("https://x/?$raw")
            val ref = uri.getQueryParameter("ref")
                ?: uri.getQueryParameter("referrer")
                ?: uri.getQueryParameter("invite")
            ParsedReferrer(
                refCode = ref?.takeIf { it.isNotBlank() },
                utmSource = uri.getQueryParameter("utm_source"),
                utmMedium = uri.getQueryParameter("utm_medium"),
                utmCampaign = uri.getQueryParameter("utm_campaign"),
            )
        } catch (_: Exception) {
            ParsedReferrer(null, null, null, null)
        }
    }
}
