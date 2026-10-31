import { redirect } from "next/navigation";

/** /admin sender til ansattlisten, som brukes mest. Tilgangen sjekkes der. */
export default function AdminPage() {
  redirect("/admin/ansatte");
}
