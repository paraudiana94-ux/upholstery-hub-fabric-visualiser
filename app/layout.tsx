import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Upholstery Hub Fabric Visualiser";
const description =
  "A live-fabric decision tool with transparent demonstration pricing and professional inspection as the next step.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000"
  )
    .split(",")[0]
    .trim();
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title: {
      default: title,
      template: "%s | Upholstery Hub",
    },
    description,
    icons: {
      icon: "/branding/UpholsteryHubIcon.png",
      shortcut: "/branding/UpholsteryHubIcon.png",
      apple: "/branding/UpholsteryHubIcon.png",
    },
    openGraph: {
      type: "website",
      locale: "en_IE",
      title,
      description,
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: "Upholstery Hub Fabric Visualiser social preview",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFFDF7",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IE">
      <body>{children}</body>
    </html>
  );
}
