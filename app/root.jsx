import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  // Server-side logging for diagnostics
  console.error("[Root ErrorBoundary Caught Exception]:", error?.stack || error?.message || error);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Something Went Wrong</title>
        <Meta />
        <Links />
      </head>
      <body style={{ margin: 0, padding: 0, fontFamily: "Inter, sans-serif", backgroundColor: "#f6f6f7" }}>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ backgroundColor: "#ffffff", padding: "32px", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", maxWidth: "480px", textAlign: "center", border: "1px solid #e1e3e5" }}>
            <h2 style={{ color: "#d72c0d", marginTop: 0, fontSize: "20px", fontWeight: "600" }}>
              Something went wrong
            </h2>
            <p style={{ color: "#4a4e52", fontSize: "14px", lineHeight: "1.5", marginBottom: "24px" }}>
              We encountered an unexpected error while processing your request. Please try refreshing the page.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: "#008060",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
                transition: "background-color 0.2s"
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
