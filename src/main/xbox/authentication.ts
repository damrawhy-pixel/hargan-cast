import { BrowserWindow, session } from "electron";

import Application from './service';
import { Xal, TokenStore } from "./xal";
import AuthTokenStore from "./helpers/tokenstore";
import StreamingToken from './xal/lib/tokens/streamingtoken';
import {
  getStreamToken,
  saveStreamToken,
  clearStreamToken,
  isStreamTokenValid,
} from './helpers/streamTokenStore';
import {
  getWebToken,
  saveWebToken,
  clearWebToken,
  isWebTokenValid,
} from './helpers/webTokenStore';
import { defaultSettings } from './settings';

const SIGN_IN_EXPIRED = "Xbox oturumu yenilenemedi. Tekrar giriş yap.";

export default class Authentication {
  _application: Application;

  _tokenStore: AuthTokenStore;
  _xal: Xal;

  _authWindow;
  _authCallback;

  _isAuthenticating: boolean = false;
  _isAuthenticated: boolean = false;
  _appLevel: number = 0;

  constructor(application: Application) {
    this._application = application;
    this._tokenStore = new AuthTokenStore();
    this._tokenStore.load();
    this._xal = new Xal(this._tokenStore);
  }

  checkAuthentication() {
    this._isAuthenticating = true;
    this._isAuthenticated = false;

    this._application.log(
      "authenticationV2",
      "[checkAuthentication()] Starting token check..."
    );
    if (this._tokenStore.hasValidAuthTokens()) {
      this._application.log(
        "authenticationV2",
        "[checkAuthentication()] Tokens are valid."
      );
      this.startSilentFlow();

      return true;
    } else {
      if (this._tokenStore.getUserToken() !== undefined) {
        // We have a user token, lets try to refresh it.
        this._application.log(
          "authenticationV2",
          "[checkAuthentication()] Tokens are expired but we have a user token. Lets try to refresh the tokens."
        );
        this.startSilentFlow();

        return true;
      } else {
        this._application.log(
          "authenticationV2",
          "[checkAuthentication()] No tokens are present."
        );
        return false;
      }
    }
  }

  startSilentFlow() {
    this._application.log(
      "authenticationV2",
      "[startSilentFlow()] Starting silent flow..."
    );
    this._isAuthenticating = true;

    // Get stream token from cache
    const _streamToken = getStreamToken();
    const _webToken = getWebToken();

    if (
      _streamToken &&
      (_streamToken.xHomeToken || _streamToken.xCloudToken) &&
      _webToken
    ) {
      const {xHomeToken, xCloudToken} = _streamToken;

      if (xHomeToken || xCloudToken) {
        this._appLevel = 1;

        if (xCloudToken) {
          this._appLevel = 2;
        }

        if (
          xHomeToken &&
          xCloudToken &&
          isStreamTokenValid(xHomeToken) &&
          isWebTokenValid(_webToken)
        ) {
          // Use cache directly
          this._application.authenticationCompleted(
            {
              xHomeToken: xHomeToken
                ? new StreamingToken(xHomeToken.data)
                : xHomeToken,
              xCloudToken: xCloudToken
                ? new StreamingToken(xCloudToken.data)
                : xCloudToken,
            },
            _webToken,
          );
        } else if (
          xCloudToken &&
          isStreamTokenValid(xCloudToken) &&
          isWebTokenValid(_webToken)
        ) {
          // Use cache directly
          this._application.authenticationCompleted(
            {
              xHomeToken: xHomeToken
                ? new StreamingToken(xHomeToken.data)
                : xHomeToken,
              xCloudToken: xCloudToken
                ? new StreamingToken(xCloudToken.data)
                : xCloudToken,
            },
            _webToken,
          );
        } else {
          // Skip refreshTokens within 23 hours
          console.log('Skip refreshTokens within 23 hours')
          if (
            Date.now() - this._tokenStore.getTokenUpdateTime() <
            23 * 60 * 60 * 1000
          ) {
            console.log('[startSilentFlow] skip refreshTokens - branch1');

            // Get new streaming token
            this.getStreamingToken(this._tokenStore)
              .then(streamingTokens => {
                // console.log('streamingTokens:', JSON.stringify(streamingTokens));
                this._xal.getWebToken(this._tokenStore).then(webToken => {
                  if (streamingTokens.xCloudToken !== null) {
                    this._appLevel = 2;
                  } else {
                    this._appLevel = 1;
                  }
                  saveStreamToken(streamingTokens);
                  saveWebToken(webToken);
                  this._application.authenticationCompleted(streamingTokens, webToken);
                });
              });
          } else {
            this._xal
              .refreshTokens(this._tokenStore)
              .then(() => {
                console.log(
                  '[startSilentFlow()] Tokens have been refreshed - branch1',
                );
                this.getStreamingToken(this._tokenStore)
                  .then(streamingTokens => {
                    // log.info('streamingTokens:', streamingTokens);
                    this._xal.getWebToken(this._tokenStore).then(webToken => {
                      if (streamingTokens.xCloudToken !== null) {
                        this._appLevel = 2;
                      } else {
                        this._appLevel = 1;
                      }
                      saveStreamToken(streamingTokens);
                      saveWebToken(webToken);
                      this._application.authenticationCompleted(streamingTokens, webToken);
                    });
                  });
              })
              .catch(e => {
                // Clear tokenstore if auth fail
                clearStreamToken();
                clearWebToken();
                this._tokenStore.clear();
                this._application.signInFailed(SIGN_IN_EXPIRED);
              });
          }
        }
      }
    } else {
      this._xal
        .refreshTokens(this._tokenStore)
        .then(() => {
          this._application.log(
            "authenticationV2",
            "[startSilentFlow()] Tokens have been refreshed"
          );

          this.getStreamingToken(this._tokenStore)
            .then((streamingTokens) => {
              if (streamingTokens.xCloudToken !== null) {
                this._application.log(
                  "authenticationV2",
                  "[startSilentFlow()] Retrieved both xHome and xCloud tokens"
                );
                this._appLevel = 2;
              } else {
                this._application.log(
                  "authenticationV2",
                  "[startSilentFlow()] Retrieved xHome token only"
                );
                this._appLevel = 1;
              }

              this._xal
                .getWebToken(this._tokenStore)
                .then((webToken) => {
                  this._application.log(
                    "authenticationV2",
                    __filename + "[startSilentFlow()] Web token received"
                  );

                  saveStreamToken(streamingTokens);
                  saveWebToken(webToken);

                  this._application.authenticationCompleted(
                    streamingTokens,
                    webToken
                  );
                })
                .catch((error) => {
                  this._application.log(
                    "authenticationV2",
                    __filename +
                      "[startSilentFlow()] Failed to retrieve web tokens:",
                    error
                  );
                  clearStreamToken();
                  clearWebToken();
                  this._tokenStore.clear();
                  this._application.signInFailed(SIGN_IN_EXPIRED);
                });
            })
            .catch((err) => {
              this._application.log(
                "authenticationV2",
                "[startSilentFlow()] Failed to retrieve streaming tokens:",
                err
              );
              clearStreamToken();
              clearWebToken();
              this._tokenStore.clear();
              this._application.signInFailed(SIGN_IN_EXPIRED);
            });
        })
        .catch(e => {
          // Clear tokenstore if auth fail
          clearStreamToken();
          clearWebToken();
          this._tokenStore.clear();
          this._application.signInFailed(SIGN_IN_EXPIRED);
        });
    }
  }

  startAuthflow() {
    this._application.log(
      "authenticationV2",
      "[startAuthflow()] Starting authentication flow"
    );

    this._xal
      .getRedirectUri()
      .then((redirect) => {
        this.openAuthWindow(redirect.sisuAuth.MsaOauthRedirect);

        this._authCallback = (redirectUri) => {
          this._isAuthenticating = true;
          this._application.log(
            "authenticationV2",
            "[startAuthFlow()] Got redirect URI:",
            redirectUri
          );
          this._xal
            .authenticateUser(this._tokenStore, redirect, redirectUri)
            .then((result) => {
              this._application.log(
                "authenticationV2",
                "[startAuthFlow()] Authenticated user:",
                result
              );

              this.startSilentFlow();
            })
            .catch((err) => {
              this._application.log(
                "authenticationV2",
                "[startAuthFlow()] Error authenticating user:",
                err
              );
              this._application.signInFailed("Microsoft girişi tamamlanamadı.");
            });
        };
      })
      .catch((err) => {
        this._application.log(
          "authenticationV2",
          "[startAuthFlow()] Error getting redirect URI:",
          err
        );
        this._application.signInFailed("Xbox giriş sunucusuna ulaşılamadı. Ağ bağlantını kontrol et.");
      });
  }

  startWebviewHooks() {
    this._application.log(
      "authenticationV2",
      "[startWebviewHooks()] Starting webview hooks"
    );

    session.fromPartition('persist:xbox').webRequest.onHeadersReceived(
      {
        urls: [
          "https://login.live.com/oauth20_authorize.srf?*",
          "https://login.live.com/ppsecure/post.srf?*",
        ],
      },
      (details, callback) => {
        const location = details.responseHeaders?.Location?.[0];
        if (
          location !== undefined &&
          location.includes(
            this._xal._app.RedirectUri
          )
        ) {
          this._application.log(
            "authenticationV2",
            "[startWebviewHooks()] Got redirect URI from OAUTH:",
            location
          );
          this._authWindow.close();

          if (this._authCallback !== undefined) {
            this._authCallback(location);
          } else {
            this._application.log(
              "authenticationV2",
              "[startWebviewHooks()] Authentication Callback is not defined:",
              this._authCallback
            );
            this._application.signInFailed("Xbox girişi tamamlanamadı. Tekrar dene.");
          }

          callback({ cancel: true });
        } else {
          callback(details);
        }
      }
    );
  }

  openAuthWindow(url) {
    const authWindow = new BrowserWindow({
      width: 520,
      height: 680,
      title: "Xbox hesabı",
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      webPreferences: { partition: "persist:xbox", sandbox: true },
    });

    authWindow.loadURL(url);
    this._authWindow = authWindow;

    this._authWindow.on("close", () => {
      this._application.log(
        "authenticationV2",
        "[openAuthWindow()] Closed auth window"
      );
      this._application.signInWindowClosed();
    });
  }

  async getStreamingToken(tokenStore: TokenStore) {
    const sisuToken = tokenStore.getSisuToken();
    if (sisuToken === undefined)
      throw new Error("Sisu token is missing. Please authenticate first");

    const xstsToken = await this._xal.doXstsAuthorization(
      sisuToken,
      "http://gssv.xboxlive.com/"
    );

    if (
      this._xal._xhomeToken === undefined ||
      this._xal._xhomeToken.getSecondsValid() <= 60
    ) {
      this._xal._xhomeToken = await this._xal.getStreamToken(
        xstsToken,
        "xhome"
      );
    }
    
    const settings: any = this._application._store.get(
      "settings",
      defaultSettings
    );
    if (
      !this._xal._xcloudToken ||
      this._xal._xcloudToken.getSecondsValid() <= 60
    ) {
      try {
        this._xal._xcloudToken = await this._xal.getStreamToken(
          xstsToken,
          "xgpuweb",
          settings.force_region_ip
        );
      } catch (error) {
        this._application.log(
          "authenticationV2",
          error
        );
        try {
          this._xal._xcloudToken = await this._xal.getStreamToken(
            xstsToken,
            "xgpuwebf2p",
            settings.force_region_ip
          );
        } catch (error) {
          this._application.cloudTokenFailed(error as Error);
          this._xal._xcloudToken = undefined;
        }
      }
    }

    return {
      xHomeToken: this._xal._xhomeToken,
      xCloudToken: this._xal._xcloudToken,
    };
  }
}
