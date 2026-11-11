package com.avectai.siapso;

import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // A WebView does not follow the network by itself: tell it, so that
        // navigator.onLine and the "Hors ligne" badge of the app match the phone.
        connectivity = getSystemService(ConnectivityManager.class);
        setOnline(hasInternet());
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> setOnline(true));
            }

            @Override
            public void onLost(Network network) {
                runOnUiThread(() -> setOnline(false));
            }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
    }

    @Override
    public void onDestroy() {
        if (connectivity != null && networkCallback != null) {
            connectivity.unregisterNetworkCallback(networkCallback);
        }
        super.onDestroy();
    }

    private boolean hasInternet() {
        Network network = connectivity.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : connectivity.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void setOnline(boolean online) {
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setNetworkAvailable(online);
        }
    }
}
