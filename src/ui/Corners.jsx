/** The chrome protective brackets from the Coming Soon card. See materials.css. */
export default function Corners({ metal = 'metal-silver', className = '' }) {
  return <span aria-hidden="true" className={`corners ${metal} ${className}`} />
}
