client({
"realm": "my-realm",
"clientId": "my-app",
"name": "My App",
"description": "My application",
"rootUrl": env.MYAPP_UI_URL,
"surrogateAuthRequired": false,
"enabled": true,
"clientAuthenticatorType": "client-secret",
"redirectUris": [
    env.MYAPP_API_URL + "/auth/login-callback",
    env.MYAPP_UI_URL + "*"
],
"webOrigins": [],
"notBefore": 0,
"bearerOnly": false,
"consentRequired": false,
"standardFlowEnabled": true,
"implicitFlowEnabled": false,
"directAccessGrantsEnabled": true,
"serviceAccountsEnabled": false,
"publicClient": true,
"frontchannelLogout": false,
"protocol": "openid-connect",
"attributes": {
    "exclude.session.state.from.auth.response": "false",
    "tls.client.certificate.bound.access.tokens": "false",
    "display.on.consent.screen": "false"
},
"authenticationFlowBindingOverrides": {},
"fullScopeAllowed": true,
"nodeReRegistrationTimeout": -1,
"defaultClientScopes": [
    "email",
    "profile",
    "roles"
],
"optionalClientScopes": [
    "address",
    "phone",
    "offline_access",
    "microprofile-jwt"
],
"access": {
    "view": true,
    "configure": true,
    "manage": true
}
});