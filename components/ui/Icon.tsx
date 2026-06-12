import clsx from "clsx";

type IconProps = {
  name: string;
  className?: string;
  title?: string;
};

export function Icon({ name, className, title }: IconProps) {
  return (
    <span aria-hidden={title ? undefined : true} title={title} className={clsx("material-symbols-outlined", className)}>
      {name}
    </span>
  );
}
