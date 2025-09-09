import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { IConstruct } from 'constructs';
import { Netmask } from 'netmask';

const block1 = new Netmask('10.0.0.0/8');
const block2 = new Netmask('172.16.0.0/12');
const block3 = new Netmask('192.168.0.0/16');

/**
 * Verify that the VPC CIDR range is within the
 * three blocks of the IP address space for private internets:
 *     10.0.0.0        -   10.255.255.255  (10/8 prefix)
 *     172.16.0.0      -   172.31.255.255  (172.16/12 prefix)
 *     192.168.0.0     -   192.168.255.255 (192.168/16 prefix)
 * Usage example:
 *  cdk.Aspects.of(app).add(new VpcCidrAspect());
 * @link http://www.faqs.org/rfcs/rfc1918.html
 */
export class vpcCidrAspect implements cdk.IAspect {
  public visit(node: IConstruct): void {
    if (node instanceof ec2.CfnVPC) {
      if (
        block1.contains(`${node.cidrBlock}`) ||
        block2.contains(`${node.cidrBlock}`) ||
        block3.contains(`${node.cidrBlock}`)
      ) {
      } else {
        cdk.Annotations.of(
          node,
        ).addError(`\nYour current VPC Cidr range ${node.cidrBlock} does not comply with the standard CIDR range in block: \n
          10.0.0.0        -   10.255.255.255  (10/8 prefix)
          172.16.0.0      -   172.31.255.255  (172.16/12 prefix)
          192.168.0.0     -   192.168.255.255 (192.168/16 prefix)`);
      }
    }
  }
}
