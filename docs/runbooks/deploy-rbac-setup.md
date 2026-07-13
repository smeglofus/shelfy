# Runbook: least-privilege deploy identity (deploy-rbac)

One-time setup that replaces the cluster-admin kubeconfig in the Deploy
workflow with a namespace-scoped ServiceAccount (`deployer`). After this,
`.github/workflows/deploy.yml` uses `/home/suslik/.kube/deploy-config`, which
can only roll Deployments in the `shelfy` namespace — not read Secrets, not
touch other namespaces.

> ⚠️ **Ordering:** run this on the k3s host **before** merging the PR that
> switches `deploy.yml` to `deploy-config`. If the workflow points at a
> kubeconfig that doesn't exist yet, the next deploy fails.

## 1. Apply the RBAC (SA + Role + RoleBinding + token Secret)

```bash
kubectl apply -f infra/k8s/deploy-rbac.yaml
```

## 2. Build the scoped kubeconfig

Run on the host, using your admin context (this is the only step that still
needs admin — reading the CA + the SA token):

```bash
NS=shelfy
SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
CA=$(kubectl -n "$NS" get secret deployer-token -o jsonpath='{.data.ca\.crt}')
TOKEN=$(kubectl -n "$NS" get secret deployer-token -o jsonpath='{.data.token}' | base64 -d)

install -m 600 /dev/null /home/suslik/.kube/deploy-config
cat > /home/suslik/.kube/deploy-config <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: shelfy
    cluster:
      server: ${SERVER}
      certificate-authority-data: ${CA}
contexts:
  - name: deployer
    context:
      cluster: shelfy
      namespace: ${NS}
      user: deployer
current-context: deployer
users:
  - name: deployer
    user:
      token: ${TOKEN}
EOF
chmod 600 /home/suslik/.kube/deploy-config
```

## 3. Verify least privilege (read-only checks)

```bash
export KUBECONFIG=/home/suslik/.kube/deploy-config
kubectl -n shelfy get deploy            # ✅ should list deployments
kubectl -n shelfy auth can-i patch deploy   # ✅ yes
kubectl -n shelfy auth can-i get secrets    # ✅ NO  (this is the point)
kubectl -n kube-system get pods         # ✅ should be Forbidden
unset KUBECONFIG
```

If `get secrets` returns `yes`, the binding is wrong — do not proceed.

## 4. Merge the PR

Once the checks above pass, merge the PR that points `deploy.yml` at
`deploy-config`. The next deploy runs with the scoped identity.

## Rotation

The token is long-lived. To rotate: delete + recreate the Secret, then re-run
step 2.

```bash
kubectl -n shelfy delete secret deployer-token
kubectl apply -f infra/k8s/deploy-rbac.yaml   # recreates the empty Secret; control plane repopulates
# then re-run step 2
```

## Follow-up: retire the admin kubeconfig from the deploy path

After a few green deploys, confirm `/home/suslik/.kube/config` (cluster-admin)
is no longer mounted by any workflow (`grep -rn '.kube/config' .github/`).
Keep the admin config off the runner's reach where practical.
