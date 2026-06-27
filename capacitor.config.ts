import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.altorstudio.chessany",
  appName: "Chessany",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
