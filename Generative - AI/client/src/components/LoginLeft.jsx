import React from "react";

const LoginLeft = () => {
  return (
    <div className="hidden lg:flex lg:w-2/5 bg-[url('bg-img.png')] bg-cover bg-center bg-no-repeat flex-col justify-between p-12 shrink-0 select-none">
      <div className="flex items-center gap-3">
        <img src="/logo.svg" alt="Logo" className="size-9.5" />
        <span className="text-4xl font-medium text-white">Generative AI</span>
      </div>
      <div>
        <h2 className="text-3xl text-white font-medium leading-snug mb-3 tracking-tight">
          Build Your Presence On Web
        </h2>
        <p className="text-zinc-300">
          Describe What You Need, Preview Instantly, And Customize Your Site In
          Real Time. React With Clean JSX, Verified Layout And Instant Code
          Exports
        </p>
      </div>
      <p className="text-zinc-300 text-sm mt-12">
        CopyRight {new Date().getFullYear()} Builder AI
      </p>
    </div>
  );
};

export default LoginLeft;
// hello
