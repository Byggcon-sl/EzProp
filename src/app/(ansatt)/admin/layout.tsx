import type { ReactNode } from "react";
import { NavLink } from "../nav-link";
import { getAdminContext } from "./admin-context";

/**
 * Undermenyen i adminområdet (skisse avsnitt 1). Vises bare for admin. Hver side gjør likevel
 * sin egen tilgangssjekk; menyen er ikke vern.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const context = await getAdminContext();
  return (
    <>
      {context && (
        <nav aria-label="Admin" className="mb-6">
          <ul className="flex flex-wrap gap-2">
            <li>
              <NavLink href="/admin/ansatte" matchChildren variant="tab">
                Ansatte
              </NavLink>
            </li>
            <li>
              <NavLink href="/admin/selskaper" matchChildren variant="tab">
                Selskaper
              </NavLink>
            </li>
            <li>
              <NavLink href="/admin/kontorer" matchChildren variant="tab">
                Kontorer
              </NavLink>
            </li>
            <li>
              <NavLink href="/admin/sertifiseringer" matchChildren variant="tab">
                Sertifiseringer
              </NavLink>
            </li>
          </ul>
        </nav>
      )}
      {children}
    </>
  );
}
