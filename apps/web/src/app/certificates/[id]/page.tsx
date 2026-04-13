"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Shield,
  Server,
  Download,
  RefreshCw,
  Trash2,
  FileKey,
  Link2,
  AlertCircle,
  Edit,
} from "lucide-react";
import { format } from "date-fns";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  CardHeader,
  CardTitle,
  Skeleton,
  Separator,
  Textarea,
  useToast,
} from "@uni-proxy-manager/ui";
import {
  formatCertificateAltNamesInput,
  parseCertificateAltNamesInput,
  useCertificate,
  useDeleteCertificate,
  useRenewCertificate,
  useUpdateCertificate,
} from "@/hooks/use-certificates";

const statusColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-500",
  pending: "bg-yellow-500/10 text-yellow-500",
  issuing: "bg-blue-500/10 text-blue-500",
  expired: "bg-red-500/10 text-red-500",
  failed: "bg-red-500/10 text-red-500",
  revoked: "bg-gray-500/10 text-gray-500",
};

export default function CertificateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const certificateId = params.id as string;

  const { data: certificate, isLoading, error } = useCertificate(certificateId);
  const deleteCertificate = useDeleteCertificate();
  const renewCertificate = useRenewCertificate();
  const updateCertificate = useUpdateCertificate();

  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenewing, setIsRenewing] = useState(false);
  const [isEditDomainsOpen, setIsEditDomainsOpen] = useState(false);
  const [isSavingDomains, setIsSavingDomains] = useState(false);
  const [editedAltNames, setEditedAltNames] = useState("");

  useEffect(() => {
    if (!certificate || !isEditDomainsOpen) {
      return;
    }

    setEditedAltNames(formatCertificateAltNamesInput(certificate.altNames));
  }, [certificate, isEditDomainsOpen]);

  const handleDownload = (type: "cert" | "key" | "chain" | "fullchain") => {
    if (!certificate) return;

    const pathMap = {
      cert: certificate.certPath,
      key: certificate.keyPath,
      chain: certificate.chainPath,
      fullchain: certificate.fullchainPath,
    };

    const path = pathMap[type];
    if (!path) {
      toast({
        title: "Error",
        description: `${type} file not available`,
        variant: "destructive",
      });
      return;
    }

    window.open(
      `/api/certificates/${certificateId}/download/${type}`,
      "_blank",
    );
  };

  const handleDelete = async () => {
    if (!certificate) return;

    if (
      !confirm(
        `Are you sure you want to delete the certificate for ${certificate.commonName}?`,
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteCertificate.mutateAsync(certificateId);
      toast({
        title: "Certificate deleted",
        description: `Certificate for ${certificate.commonName} has been deleted.`,
      });
      router.push("/certificates");
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to delete certificate",
        variant: "destructive",
      });
      setIsDeleting(false);
    }
  };

  const handleForceRenewal = async () => {
    if (!certificate) return;

    const action =
      certificate.status === "failed" ? "retry issuance" : "force renewal";
    if (
      !confirm(
        `Are you sure you want to ${action} for ${certificate.commonName}?`,
      )
    ) {
      return;
    }

    setIsRenewing(true);
    try {
      await renewCertificate.mutateAsync(certificateId);
      toast({
        title:
          certificate.status === "failed"
            ? "Retry initiated"
            : "Renewal initiated",
        description: `Certificate ${action} has been queued for ${certificate.commonName}.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : `Failed to ${action}`,
        variant: "destructive",
      });
    } finally {
      setIsRenewing(false);
    }
  };

  const handleEditDomains = () => {
    if (!certificate) {
      return;
    }

    setEditedAltNames(formatCertificateAltNamesInput(certificate.altNames));
    setIsEditDomainsOpen(true);
  };

  const handleSaveDomains = async () => {
    if (!certificate) {
      return;
    }

    const altNames = parseCertificateAltNamesInput(
      editedAltNames,
      certificate.commonName,
    );

    setIsSavingDomains(true);

    try {
      await updateCertificate.mutateAsync({
        id: certificateId,
        data: {
          altNames,
          reissue: true,
        },
      });

      setIsEditDomainsOpen(false);
      toast({
        title: "Certificate updated",
        description:
          "The certificate domain list was saved and a reissue has been queued.",
      });
    } catch (saveError) {
      toast({
        title: "Error",
        description:
          saveError instanceof Error
            ? saveError.message
            : "Failed to update the certificate domain list",
        variant: "destructive",
      });
    } finally {
      setIsSavingDomains(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push("/certificates")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Certificates
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Error Loading Certificate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>
                {error instanceof Error
                  ? error.message
                  : "Failed to load certificate"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !certificate) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const daysUntilExpiry = certificate.expiresAt
    ? Math.floor(
        (new Date(certificate.expiresAt).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            onClick={() => router.push("/certificates")}
            className="mb-2"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Certificates
          </Button>
          <h1 className="text-3xl font-bold">{certificate.commonName}</h1>
          <p className="text-muted-foreground">SSL/TLS Certificate Details</p>
        </div>
        <Badge className={statusColors[certificate.status]}>
          {certificate.status}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Certificate Information */}
        <Card>
          <CardHeader>
            <CardTitle>Certificate Information</CardTitle>
            <CardDescription>
              Details about this SSL/TLS certificate
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-muted p-2">
                <Shield className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Common Name</p>
                <p className="font-medium">{certificate.commonName}</p>
              </div>
            </div>

            {certificate.altNames && certificate.altNames.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-muted p-2">
                  <Link2 className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">
                    Alternative Names
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {certificate.altNames.map((name) => (
                      <Badge key={name} variant="outline" className="text-xs">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <Separator />

            <div className="flex items-center gap-3">
              <div className="rounded-md bg-muted p-2">
                <Calendar className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Issued At</p>
                <p className="font-medium">
                  {certificate.issuedAt
                    ? format(new Date(certificate.issuedAt), "PPP")
                    : "Not issued"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="rounded-md bg-muted p-2">
                <Calendar className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Expires At</p>
                <p className="font-medium">
                  {certificate.expiresAt
                    ? format(new Date(certificate.expiresAt), "PPP")
                    : "Not set"}
                </p>
                {daysUntilExpiry !== null && (
                  <p
                    className={`text-sm ${daysUntilExpiry < 30 ? "text-orange-500" : "text-muted-foreground"}`}
                  >
                    {daysUntilExpiry > 0
                      ? `${daysUntilExpiry} days remaining`
                      : `Expired ${Math.abs(daysUntilExpiry)} days ago`}
                  </p>
                )}
              </div>
            </div>

            {certificate.fingerprint && (
              <>
                <Separator />
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2">
                    <FileKey className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Fingerprint</p>
                    <p className="font-mono text-xs break-all">
                      {certificate.fingerprint}
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Certificate Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Settings & Configuration</CardTitle>
            <CardDescription>
              Auto-renewal and related information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-muted p-2">
                <RefreshCw className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Auto-Renewal</p>
                <p className="font-medium">
                  {certificate.autoRenew ? "Enabled" : "Disabled"}
                </p>
                {certificate.autoRenew && (
                  <p className="text-sm text-muted-foreground">
                    Renews {certificate.renewBeforeDays} days before expiry
                  </p>
                )}
              </div>
            </div>

            {certificate.domain && (
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-muted p-2">
                  <Server className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">
                    Related Domain
                  </p>
                  <Button
                    variant="link"
                    className="h-auto p-0 font-medium"
                    onClick={() =>
                      router.push(`/domains/${certificate.domainId}`)
                    }
                  >
                    {certificate.domain.hostname}
                  </Button>
                </div>
              </div>
            )}

            {certificate.dnsProvider && (
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-muted p-2">
                  <Link2 className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">DNS Provider</p>
                  <p className="font-medium">
                    {certificate.dnsProvider.name} (
                    {certificate.dnsProvider.type})
                  </p>
                </div>
              </div>
            )}

            {certificate.lastError && (
              <>
                <Separator />
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <p className="text-sm font-medium text-destructive">
                      Last Error
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {certificate.lastError}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Actions Card */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>Manage this certificate</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={handleEditDomains}
              disabled={isSavingDomains}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit Domains & Reissue
            </Button>

            <Button
              variant="outline"
              onClick={() => handleDownload("cert")}
              disabled={!certificate.certPath}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Certificate
            </Button>

            <Button
              variant="outline"
              onClick={() => handleDownload("key")}
              disabled={!certificate.keyPath}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Private Key
            </Button>

            <Button
              variant="outline"
              onClick={() => handleDownload("fullchain")}
              disabled={!certificate.fullchainPath}
            >
              <Download className="mr-2 h-4 w-4" />
              Download Full Chain
            </Button>

            <Button
              variant="outline"
              onClick={handleForceRenewal}
              disabled={
                certificate.status === "issuing" ||
                certificate.status === "pending" ||
                isRenewing ||
                renewCertificate.isPending
              }
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isRenewing ? "animate-spin" : ""}`}
              />
              {isRenewing
                ? "Processing..."
                : certificate.status === "failed"
                  ? "Retry Issuance"
                  : "Force Renewal"}
            </Button>

            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting || deleteCertificate.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {isDeleting ? "Deleting..." : "Delete Certificate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isEditDomainsOpen} onOpenChange={setIsEditDomainsOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Edit Certificate Domains</DialogTitle>
            <DialogDescription>
              Review the primary domain and update the additional names on this
              certificate, then save to reissue it on the same certificate
              record.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert>
              <AlertTitle>Reissue will be triggered</AlertTitle>
              <AlertDescription>
                Saving this form updates the certificate's domain list and
                starts a reissue. Domains using this certificate may briefly
                show SSL issue status until the new certificate is active.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Primary domain</Label>
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
                {certificate.commonName}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="certificate-alt-names">Additional domains</Label>
              <Textarea
                id="certificate-alt-names"
                value={editedAltNames}
                onChange={(event) => setEditedAltNames(event.target.value)}
                placeholder="www.example.com&#10;api.example.com&#10;*.staging.example.com"
                className="min-h-[120px]"
                disabled={isSavingDomains}
              />
              <p className="text-sm text-muted-foreground">
                Enter one name per line or comma-separated. The primary domain
                will be excluded from the SAN list automatically.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditDomainsOpen(false)}
              disabled={isSavingDomains}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveDomains}
              disabled={isSavingDomains}
            >
              {isSavingDomains ? "Saving..." : "Save & Reissue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
