import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { ProfileContent } from "./profile-content";

export default function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <ProfileContent />;
}
