import { DescribeDBInstancesCommand } from "@aws-sdk/client-rds";

async function listInstances(rds) {
  const { DBInstances } = await rds.send(new DescribeDBInstancesCommand({}));
  return DBInstances || [];
}

export async function checkRdsPubliclyAccessible(rds) {
  const instances = await listInstances(rds);
  if (instances.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No RDS instances found", evidencePayload: {} }];
  }
  return instances.map((instance) => {
    const pass = !instance.PubliclyAccessible;
    return {
      resourceId: instance.DBInstanceArn || instance.DBInstanceIdentifier,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${instance.DBInstanceIdentifier} is not publicly accessible`
        : `${instance.DBInstanceIdentifier} is publicly accessible`,
      evidencePayload: { dbInstanceIdentifier: instance.DBInstanceIdentifier, publiclyAccessible: Boolean(instance.PubliclyAccessible) },
    };
  });
}

export async function checkRdsStorageEncrypted(rds) {
  const instances = await listInstances(rds);
  if (instances.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No RDS instances found", evidencePayload: {} }];
  }
  return instances.map((instance) => {
    const pass = Boolean(instance.StorageEncrypted);
    return {
      resourceId: instance.DBInstanceArn || instance.DBInstanceIdentifier,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${instance.DBInstanceIdentifier} has storage encryption enabled`
        : `${instance.DBInstanceIdentifier} does not have storage encryption enabled`,
      evidencePayload: { dbInstanceIdentifier: instance.DBInstanceIdentifier, storageEncrypted: Boolean(instance.StorageEncrypted) },
    };
  });
}

export async function checkRdsAutomatedBackupsEnabled(rds) {
  const instances = await listInstances(rds);
  if (instances.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No RDS instances found", evidencePayload: {} }];
  }
  return instances.map((instance) => {
    const retention = instance.BackupRetentionPeriod || 0;
    const pass = retention > 0;
    return {
      resourceId: instance.DBInstanceArn || instance.DBInstanceIdentifier,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${instance.DBInstanceIdentifier} has automated backups enabled (${retention}-day retention)`
        : `${instance.DBInstanceIdentifier} has automated backups disabled`,
      evidencePayload: { dbInstanceIdentifier: instance.DBInstanceIdentifier, backupRetentionPeriod: retention },
    };
  });
}

export const rdsTests = [
  { key: "aws.rds.publicly_accessible", title: "RDS instances are not publicly accessible", failTitle: "RDS instance is publicly accessible", severityDefault: "critical", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkRdsPubliclyAccessible(clients.rds) },
  { key: "aws.rds.storage_encrypted", title: "RDS instances have storage encryption enabled", failTitle: "RDS instance does not have storage encryption enabled", severityDefault: "critical", isoReferences: ["A.8.2.3"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkRdsStorageEncrypted(clients.rds) },
  { key: "aws.rds.automated_backups_enabled", title: "RDS instances have automated backups enabled", failTitle: "RDS instance does not have automated backups enabled", severityDefault: "high", isoReferences: ["A.12.3.1"], dpdpaControlAreas: ["Backup & Recovery"], run: (clients) => checkRdsAutomatedBackupsEnabled(clients.rds) },
];
