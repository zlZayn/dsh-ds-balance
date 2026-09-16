/** CSS Modules 类型声明：只给出类名映射，不做值校验。 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
