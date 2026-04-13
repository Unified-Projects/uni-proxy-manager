"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
  useToast,
} from "@uni-proxy-manager/ui";
import { useCreateClusterNode } from "@/hooks/use-cluster";

const formSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  apiUrl: z.string().url("Must be a valid URL (e.g. http://192.168.1.10:3000)"),
  apiKey: z.string().min(1, "API key is required"),
  isLocal: z.boolean(),
});

type FormData = z.infer<typeof formSchema>;

interface AddNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddNodeDialog({ open, onOpenChange }: AddNodeDialogProps) {
  const { toast } = useToast();
  const createNode = useCreateClusterNode();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", apiUrl: "", apiKey: "", isLocal: false },
  });

  const onSubmit = async (data: FormData) => {
    try {
      await createNode.mutateAsync(data);
      toast({ title: "Node registered" });
      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to register node",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Cluster Node</DialogTitle>
          <DialogDescription>
            Register another Uni-Proxy-Manager instance to receive config syncs.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Node Name</FormLabel>
                  <FormControl>
                    <Input placeholder="node-2" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="apiUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API URL</FormLabel>
                  <FormControl>
                    <Input placeholder="http://192.168.1.10:3000" {...field} />
                  </FormControl>
                  <FormDescription>Base origin of the remote UPM API. Use only the scheme, host, and port.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Remote node API key" {...field} />
                  </FormControl>
                  <FormDescription>
                    Set UNI_PROXY_MANAGER_API_KEY on the remote node
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isLocal"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>This is the local node</FormLabel>
                    <FormDescription>
                      Mark this entry as representing the current instance (for peers config)
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createNode.isPending}>
                {createNode.isPending ? "Registering..." : "Register Node"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
