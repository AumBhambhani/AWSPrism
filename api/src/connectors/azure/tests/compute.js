function resourceGroupFromId(id) {
  return id.match(/resourceGroups\/([^/]+)\//i)?.[1];
}

function nameFromId(id) {
  return id.split("/").pop();
}

async function listVms(compute) {
  const vms = [];
  for await (const vm of compute.virtualMachines.listAll()) vms.push(vm);
  return vms;
}

export async function checkDiskEncryptionEnabled(compute) {
  const vms = await listVms(compute);
  if (vms.length === 0) {
    return [{ resourceId: "subscription", status: "not_applicable", message: "No virtual machines found", evidencePayload: {} }];
  }
  return vms.map((vm) => {
    const enabled = vm.securityProfile?.encryptionAtHost === true;
    return {
      resourceId: vm.id,
      status: enabled ? "pass" : "fail",
      message: enabled ? `${vm.name} has encryption at host enabled` : `${vm.name} does not have encryption at host enabled`,
      evidencePayload: { vmName: vm.name, encryptionAtHost: vm.securityProfile?.encryptionAtHost ?? null },
    };
  });
}

export async function checkNoPublicIpAssociation(compute, network) {
  const vms = await listVms(compute);
  if (vms.length === 0) {
    return [{ resourceId: "subscription", status: "not_applicable", message: "No virtual machines found", evidencePayload: {} }];
  }
  const results = [];
  for (const vm of vms) {
    const nicRefs = (vm.networkProfile?.networkInterfaces || []).filter((ref) => ref.id);
    const publicIpNics = [];
    for (const ref of nicRefs) {
      const nic = await network.networkInterfaces.get(resourceGroupFromId(ref.id), nameFromId(ref.id));
      const exposed = (nic.ipConfigurations || []).some((cfg) => cfg.publicIPAddress);
      if (exposed) publicIpNics.push(nameFromId(ref.id));
    }
    const pass = publicIpNics.length === 0;
    results.push({
      resourceId: vm.id,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${vm.name} has no network interfaces with a public IP address`
        : `${vm.name} has a network interface with a public IP address (${publicIpNics.join(", ")})`,
      evidencePayload: { vmName: vm.name, publicIpNics },
    });
  }
  return results;
}

export const computeTests = [
  { key: "azure.compute.disk_encryption_enabled", title: "Virtual machines have encryption at host enabled", failTitle: "Virtual machine does not have encryption at host enabled", severityDefault: "high", isoReferences: ["A.8.2.3"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkDiskEncryptionEnabled(clients.compute) },
  { key: "azure.compute.no_public_ip_association", title: "Virtual machines are not directly exposed via a public IP address", failTitle: "Virtual machine network interface has a public IP address attached", severityDefault: "critical", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkNoPublicIpAssociation(clients.compute, clients.network) },
];
