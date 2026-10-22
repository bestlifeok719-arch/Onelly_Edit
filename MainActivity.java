package app.onelly.edit;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(OnellyExport.class);
    super.onCreate(savedInstanceState);
  }
}
