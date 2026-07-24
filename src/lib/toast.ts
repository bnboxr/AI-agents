import toast from "react-hot-toast";

export const notify = {
  success: (msg: string) => toast.success(msg),
  error: (msg: string) => toast.error(msg),
  loading: (msg: string) => toast.loading(msg),
  info: (msg: string) =>
    toast(msg, {
      icon: "ℹ",
      style: {
        background: "#0d1117",
        color: "#b0bec5",
        border: "1px solid #1a1f2e",
      },
    }),
  promise: toast.promise,
  dismiss: toast.dismiss,
};
