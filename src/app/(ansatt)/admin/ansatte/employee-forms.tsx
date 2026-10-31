"use client";

import { useActionState, type ReactNode } from "react";
import type { GrantablePermission } from "@/core/access";
import type { EmployeeRole } from "@/db/schema";
import { Card } from "@/shared/ui/card";
import { Checkbox, ChoiceGroup, Field, Input, Radio } from "@/shared/ui/form";
import { FormActions, FormErrors, SubmitButton } from "../form-parts";
import { initialFormState, listValue, textValue, type FormState } from "../form-state";
import { permissionLabels, roleDescriptions, roleFormOrder, roleLabels } from "../labels";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
type Choice = { id: string; name: string };

export type EmployeeDetails = {
  name: string;
  email: string | null;
  jobTitle: string | null;
  companyId: string | null;
  officeId: string | null;
};

const LOCKED = "Angre sluttet for å endre.";

function ChoiceRadios({
  id,
  legend,
  choices,
  selected,
  error,
}: {
  id: string;
  legend: string;
  choices: Choice[];
  selected: string;
  error?: string;
}) {
  // Valgt id som ikke finnes lenger (slettet), gir «Ikke valgt» avkrysset.
  const current = choices.some((choice) => choice.id === selected) ? selected : "";
  return (
    <ChoiceGroup id={id} legend={legend} error={error} columns>
      <Radio name={id} value="" label="Ikke valgt" defaultChecked={current === ""} />
      {choices.map((choice) => (
        <Radio
          key={choice.id}
          name={id}
          value={choice.id}
          label={choice.name}
          defaultChecked={current === choice.id}
        />
      ))}
    </ChoiceGroup>
  );
}

function RoleChoices({
  selected,
  error,
  withDescriptions,
}: {
  selected: readonly string[];
  error?: string;
  withDescriptions: boolean;
}) {
  return (
    <ChoiceGroup id="roles" legend="Roller" error={error} columns>
      {roleFormOrder.map((role) => (
        <Checkbox
          key={role}
          name="roles"
          value={role}
          label={roleLabels[role]}
          description={withDescriptions ? roleDescriptions[role] : undefined}
          defaultChecked={selected.includes(role)}
        />
      ))}
    </ChoiceGroup>
  );
}

/**
 * Ny ansatt (med e-post og roller) eller opplysningene til en eksisterende (e-posten vises som
 * tekst og kan ikke endres). Skisse avsnitt 4.
 */
export function EmployeeDetailsForm({
  employee,
  companies,
  offices,
  action,
  locked = false,
  loginUrl,
}: {
  employee?: EmployeeDetails;
  companies: Choice[];
  offices: Choice[];
  action: Action;
  locked?: boolean;
  /** Adressen til innloggingssiden, vises under skjemaet for ny ansatt. */
  loginUrl?: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const isNew = employee === undefined;
  const error = (name: string) => state.fieldErrors[name];

  const fields = (
    <>
      <FormErrors state={state} />
      {locked && <p className="text-sm text-slate-600">{LOCKED}</p>}
      <fieldset disabled={locked} className="min-w-0 space-y-5">
        <Field label="Navn" htmlFor="name" error={error("name")}>
          <Input
            id="name"
            name="name"
            required
            autoComplete="off"
            defaultValue={textValue(state, "name", employee?.name)}
          />
        </Field>
        {isNew ? (
          <Field
            label="E-post"
            htmlFor="email"
            hint="Personen logger inn med en kode som sendes til denne adressen. Den kan ikke endres senere."
            error={error("email")}
          >
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="off"
              defaultValue={textValue(state, "email", "")}
            />
          </Field>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700">E-post</p>
            <p className="break-words text-slate-900">{employee.email}</p>
            <p className="text-sm text-slate-600">
              Kan ikke endres. Er den feil: marker som sluttet og legg inn personen på nytt.
            </p>
          </div>
        )}
        <Field label="Stilling (valgfritt)" htmlFor="jobTitle" error={error("jobTitle")}>
          <Input
            id="jobTitle"
            name="jobTitle"
            autoComplete="off"
            defaultValue={textValue(state, "jobTitle", employee?.jobTitle)}
          />
        </Field>
        <ChoiceRadios
          id="companyId"
          legend="Selskap (valgfritt)"
          choices={companies}
          selected={textValue(state, "companyId", employee?.companyId)}
          error={error("companyId")}
        />
        <ChoiceRadios
          id="officeId"
          legend="Kontor (valgfritt)"
          choices={offices}
          selected={textValue(state, "officeId", employee?.officeId)}
          error={error("officeId")}
        />
        {isNew && (
          <RoleChoices
            selected={listValue(state, "roles", ["inspector"])}
            error={error("roles")}
            withDescriptions={false}
          />
        )}
      </fieldset>
    </>
  );

  return (
    <form action={formAction} noValidate>
      {isNew ? (
        <>
          <Card className="space-y-5">{fields}</Card>
          <p className="mt-4 text-sm text-slate-600">
            Det sendes ingen e-post. Si fra til personen at de kan logge inn på{" "}
            <span className="break-all">{loginUrl}</span>.
          </p>
          <div className="mt-2">
            <FormActions cancelHref="/admin/ansatte" />
          </div>
        </>
      ) : (
        <EmployeeCard title="Opplysninger">
          {fields}
          <FormActions cancelHref="/admin/ansatte" />
        </EmployeeCard>
      )}
    </form>
  );
}

/** Kort med h2 på siden til den ansatte. */
export function EmployeeCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-5">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </Card>
  );
}

/** Rollene til en eksisterende ansatt, med kort forklaring under hver. */
export function RolesForm({
  roles,
  action,
  locked,
}: {
  roles: readonly EmployeeRole[];
  action: Action;
  locked: boolean;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  // Stoppes endringen (for eksempel siste admin), står avkryssingen slik den var før.
  const selected = state.message ? roles : listValue(state, "roles", roles);
  return (
    <form action={formAction} noValidate>
      <EmployeeCard title="Roller">
        <FormErrors state={state} />
        {locked && <p className="text-sm text-slate-600">{LOCKED}</p>}
        <fieldset disabled={locked} className="min-w-0 space-y-5">
          <RoleChoices selected={selected} error={state.fieldErrors.roles} withDescriptions />
          <SubmitButton variant="secondary" size="md">
            Lagre roller
          </SubmitButton>
        </fieldset>
      </EmployeeCard>
    </form>
  );
}

/** Enkeltrettigheter i tillegg til rollene. Viser ikke hva rollene alt gir. */
export function PermissionsForm({
  permissions,
  grantable,
  action,
  locked,
}: {
  permissions: readonly string[];
  grantable: readonly GrantablePermission[];
  action: Action;
  locked: boolean;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const selected = state.message ? permissions : listValue(state, "permissions", permissions);
  return (
    <form action={formAction} noValidate>
      <EmployeeCard title="Enkeltrettigheter">
        <FormErrors state={state} />
        {locked && <p className="text-sm text-slate-600">{LOCKED}</p>}
        <fieldset disabled={locked} className="min-w-0 space-y-5">
          <ChoiceGroup id="permissions" legend="Rettigheter" hint="I tillegg til rollene.">
            {grantable.map((permission) => (
              <Checkbox
                key={permission}
                name="permissions"
                value={permission}
                label={permissionLabels[permission]}
                description={
                  permission === "report.publish" ? "Krever gyldig sertifisering." : undefined
                }
                defaultChecked={selected.includes(permission)}
              />
            ))}
          </ChoiceGroup>
          <SubmitButton variant="secondary" size="md">
            Lagre rettigheter
          </SubmitButton>
        </fieldset>
      </EmployeeCard>
    </form>
  );
}

/** «Har sluttet» eller «Angre sluttet». */
export function StatusForm({
  deactivatedOn,
  canReactivate,
  action,
}: {
  /** Dato personen sluttet («31.10.2026»), eller `null` hvis hen jobber her. */
  deactivatedOn: string | null;
  canReactivate: boolean;
  action: Action;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  if (deactivatedOn === null) {
    return (
      <form action={formAction}>
        <EmployeeCard title="Har sluttet">
          <FormErrors state={state} />
          <p className="text-slate-600">
            Personen kan ikke bruke systemet, men står fortsatt på rapportene sine. Kan angres.
          </p>
          <SubmitButton variant="secondary" size="md">
            Har sluttet
          </SubmitButton>
        </EmployeeCard>
      </form>
    );
  }
  return (
    <form action={formAction}>
      <EmployeeCard title="Sluttet">
        <FormErrors state={state} />
        <p className="text-slate-600">Sluttet {deactivatedOn}. Personen kan ikke bruke systemet.</p>
        {canReactivate ? (
          <SubmitButton variant="secondary" size="md">
            Angre sluttet
          </SubmitButton>
        ) : (
          <p className="text-slate-600">Kan ikke angres: personen har ingen innlogging.</p>
        )}
      </EmployeeCard>
    </form>
  );
}
