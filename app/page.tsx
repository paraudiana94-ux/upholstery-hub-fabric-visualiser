import type { Metadata } from "next";
import { Visualiser } from "./Visualiser";

export const metadata: Metadata = {
  title: "Fabric Visualiser",
  description:
    "Explore live demonstration fabrics and an indicative upholstery estimate before professional inspection.",
};

export default function Home() {
  return <Visualiser />;
}
