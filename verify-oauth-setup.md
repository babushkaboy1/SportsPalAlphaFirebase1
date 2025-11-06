# OAuth Setup Verification Checklist

## ✅ Google Sign-In

### Firebase Console
https://console.firebase.google.com/project/sportspal-1b468/authentication/providers

**Check:**
- [ ] Google provider is ENABLED
- [ ] Web client ID matches: `797980453879-us77gkeq4najb1bno3ftbounlqjc5vdn.apps.googleusercontent.com`

### Firebase Project Settings (Android SHA-1)
https://console.firebase.google.com/project/sportspal-1b468/settings/general

**Check:**
- [ ] Scroll to "Your apps" → Android app (com.sportspal.app)
- [ ] Click on the app
- [ ] Under "SHA certificate fingerprints"
- [ ] Add SHA-1: `A1:44:BD:09:6C:D9:38:6D:FF:00:56:4C:CF:D5:C7:F5:D3:3B:FB:56`
- [ ] Click Save

### Google Cloud Console
https://console.cloud.google.com/apis/credentials?project=sportspal-1b468

**Verify these OAuth 2.0 Client IDs exist:**
- [ ] Web client: `797980453879-us77gkeq4najb1bno3ftbounlqjc5vdn.apps.googleusercontent.com`
- [ ] iOS client: `797980453879-nm6nq024jdb77gn5euhlrkmmd1t0tu68.apps.googleusercontent.com`
- [ ] Android client: `797980453879-2s8joa3gkv6n5a70ekuv1jtgmt916hig.apps.googleusercontent.com`

---

## ✅ Facebook Login

### Firebase Console
https://console.firebase.google.com/project/sportspal-1b468/authentication/providers

**Check:**
- [ ] Facebook provider is ENABLED
- [ ] App ID: `4732028037023928`
- [ ] App Secret: `63fc150c77f461bfe69466108d2ef3a6`
- [ ] OAuth redirect URI copied: `https://sportspal-1b468.firebaseapp.com/__/auth/handler`

### Facebook Developer Console
https://developers.facebook.com/apps/4732028037023928/settings/basic/

**Check:**
- [ ] App ID: `4732028037023928`
- [ ] Under "Facebook Login" → Settings
- [ ] Valid OAuth Redirect URIs contains: `https://sportspal-1b468.firebaseapp.com/__/auth/handler`

**Android Platform:**
- [ ] Package Name: `com.sportspal.app` (or `com.sportspal`)
- [ ] Class Name: `com.sportspal.app.MainActivity`
- [ ] Key Hash: `oUS9CWzZOG3/AFZMz9XH9dM7+1Y=`

**iOS Platform:**
- [ ] Bundle ID: `com.sportspal`
- [ ] Single Sign On: Enabled

---

## ✅ Apple Sign-In

### Firebase Console
https://console.firebase.google.com/project/sportspal-1b468/authentication/providers

**Check:**
- [ ] Apple provider is ENABLED

---

## 📱 Local Testing

### Environment Variables (.env.local)
```bash
# Google
GOOGLE_WEB_CLIENT_ID=797980453879-us77gkeq4najb1bno3ftbounlqjc5vdn.apps.googleusercontent.com
GOOGLE_IOS_CLIENT_ID=797980453879-nm6nq024jdb77gn5euhlrkmmd1t0tu68.apps.googleusercontent.com
GOOGLE_ANDROID_CLIENT_ID=797980453879-2s8joa3gkv6n5a70ekuv1jtgmt916hig.apps.googleusercontent.com

# Facebook
FACEBOOK_APP_ID=4732028037023928
```

### EAS Secrets
- [ ] Run: `eas secret:list`
- [ ] Verify all variables are pushed

### Test
```bash
npx expo start --clear
```

**Test flow for each provider:**
1. Click sign in button
2. Complete OAuth flow
3. **New user**: Should redirect to CreateProfile with email locked
4. **Existing user**: Should log in directly to MainTabs

---

## 🔍 Troubleshooting

### Google Sign-In Error: "Invalid Idp Response"
- **Fix**: Add SHA-1 to Firebase Android app settings
- **URL**: https://console.firebase.google.com/project/sportspal-1b468/settings/general

### Facebook Login Error: "Invalid key hash"
- **Fix**: Verify key hash in Facebook Developer Console
- **Expected**: `oUS9CWzZOG3/AFZMz9XH9dM7+1Y=`

### Any OAuth Error: "redirect_uri_mismatch"
- **Fix**: Verify redirect URIs match exactly in all consoles
- **Expected**: `https://sportspal-1b468.firebaseapp.com/__/auth/handler`
