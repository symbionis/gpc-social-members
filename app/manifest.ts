import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Geneva Polo Club",
    short_name: "Geneva Polo Club",
    description: "Geneva Polo Club — Social Member Club",
    start_url: "/card",
    display: "standalone",
    background_color: "#052938",
    theme_color: "#052938",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
