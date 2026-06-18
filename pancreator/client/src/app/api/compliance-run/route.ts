import {
  executeComplianceRun,
  isKnownDescriptorId,
  listComplianceDescriptors,
  validateDescriptorId,
} from "@/services/maintenance-compliance";

type ComplianceRunRequestBody = {
  descriptorId?: string;
};

export async function GET(): Promise<Response> {
  try {
    const descriptors = await listComplianceDescriptors();
    return Response.json({ descriptors });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list compliance descriptors";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: ComplianceRunRequestBody = {};
  try {
    body = (await request.json()) as ComplianceRunRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const descriptorId = body.descriptorId?.trim();
  if (descriptorId !== undefined && descriptorId.length > 0) {
    const validation = validateDescriptorId(descriptorId);
    if (validation !== null) {
      return Response.json({ error: validation.error }, { status: 400 });
    }
    if (!(await isKnownDescriptorId(descriptorId))) {
      return Response.json({ error: `Unknown compliance descriptor "${descriptorId}"` }, { status: 400 });
    }
  }

  try {
    const result = await executeComplianceRun(descriptorId);
    return Response.json(
      {
        ...result.report,
        exitCode: result.exitCode,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Compliance run failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
