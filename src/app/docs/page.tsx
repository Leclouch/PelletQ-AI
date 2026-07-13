"use client";

import { useEffect } from "react";

// Swagger UI dirender dari CDN (swagger-ui-dist) agar tidak menambah
// dependency npm yang bentrok dengan React 19. Membaca spec dari /api/docs.
const SWAGGER_VERSION = "5.17.14";

export default function ApiDocsPage() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`;
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = `https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js`;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      (window as unknown as { SwaggerUIBundle: (opts: unknown) => void }).SwaggerUIBundle({
        url: "/api/docs",
        dom_id: "#swagger-ui",
        deepLinking: true,
        tryItOutEnabled: true,
      });
    };
    document.body.appendChild(script);

    return () => {
      link.remove();
      script.remove();
    };
  }, []);

  return <div id="swagger-ui" style={{ minHeight: "100vh", background: "#fff" }} />;
}
