const SDK_SCRIPT_ID = 'facebook-jssdk';
const SDK_SOURCE = 'https://connect.facebook.net/en_US/sdk.js';

let sdkPromise = null;
let sdkConfig = null;

function initFacebookSdk({ appId, version }) {
  const FB = window.FB;
  if (!FB || typeof FB.init !== 'function') {
    throw new Error('The Facebook SDK could not be initialised.');
  }

  FB.init({
    appId,
    cookie: true,
    xfbml: true,
    version,
  });
  return FB;
}

export function loadFacebookSdk({ appId, version = 'v25.0' } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('The Facebook SDK is only available in the browser.'));
  }
  if (!appId) {
    return Promise.reject(new Error('The Meta app ID is not configured.'));
  }

  if (sdkPromise) {
    if (window.FB && typeof window.FB.init === 'function') {
      try {
        initFacebookSdk({ appId, version });
        return Promise.resolve(window.FB);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return sdkPromise;
  }

  sdkConfig = { appId, version };
  window.fbAsyncInit = () => {
    try {
      initFacebookSdk(sdkConfig);
    } catch {
      window.fbAsyncInit = null;
    }
  };

  sdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(SDK_SCRIPT_ID);
    const script = existingScript ?? document.createElement('script');

    if (!existingScript) {
      script.id = SDK_SCRIPT_ID;
      script.src = SDK_SOURCE;
      script.async = true;
      script.defer = true;
    }

    script.onload = () => {
      if (window.FB && typeof window.FB.init === 'function') {
        resolve(window.FB);
        return;
      }
      sdkPromise = null;
      reject(new Error('The Facebook SDK could not be loaded.'));
    };
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('The Facebook SDK could not be loaded.'));
    };

    if (!existingScript) document.head.appendChild(script);
  });

  return sdkPromise;
}

function loginWithFacebook(FB, { configId, version }) {
  return new Promise((resolve, reject) => {
    try {
      FB.login(
        (response) => {
          const code = response?.authResponse?.code ?? null;
          if (!code) {
            reject(new Error('WhatsApp Embedded Signup did not return an authorization code.'));
            return;
          }
          resolve(code);
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: version === 'v5' ? { version: 'v5' } : {},
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

export function launchWhatsAppEmbeddedSignup({
  appId,
  configId,
  version = 'v4',
  graphApiVersion = 'v25.0',
  onComplete,
  onCancel,
  onError,
} = {}) {
  const notifyError = (error) => {
    if (typeof onError === 'function') onError(error);
  };

  if (typeof window === 'undefined' || !appId || !configId) {
    notifyError(new Error('WhatsApp Embedded Signup is not configured.'));
    return () => {};
  }

  let settled = false;
  let code = null;
  let session = null;

  const cleanup = () => {
    window.removeEventListener('message', handleMessage);
  };

  const settle = (outcome, value) => {
    if (settled) return;
    settled = true;
    cleanup();

    if (outcome === 'complete') {
      if (typeof onComplete === 'function') onComplete(value);
    } else if (outcome === 'cancel') {
      if (typeof onCancel === 'function') onCancel();
    } else {
      notifyError(value);
    }
  };

  const complete = () => {
    if (code && session) {
      settle('complete', {
        code,
        wabaId: session.wabaId,
        phoneNumberId: session.phoneNumberId,
        businessPortfolioId: session.businessPortfolioId,
      });
    }
  };

  function handleMessage(event) {
    if (!event.origin || !event.origin.endsWith('facebook.com')) return;
    if (event.data?.type !== 'WA_EMBEDDED_SIGNUP') return;

    const action = event.data.action ?? event.data.status;

    if (action === 'CANCEL') {
      settle('cancel');
      return;
    }
    if (action === 'ERROR') {
      settle('error', event.data.data ?? event.data);
      return;
    }
    if (action !== 'FINISH') return;

    session = {
      wabaId: event.data.data?.waba_id ?? null,
      phoneNumberId: event.data.data?.phone_number_id ?? null,
      businessPortfolioId: event.data.data?.business_id ?? null,
    };
    complete();
  }

  window.addEventListener('message', handleMessage);

  loadFacebookSdk({ appId, version: graphApiVersion })
    .then((FB) => loginWithFacebook(FB, { configId, version }))
    .then((authCode) => {
      if (settled) return;
      code = authCode;
      complete();
    })
    .catch((error) => {
      settle('error', error);
    });

  return cleanup;
}
